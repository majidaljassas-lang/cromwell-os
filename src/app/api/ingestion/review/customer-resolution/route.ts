import { prisma } from "@/lib/prisma";
import { matchCustomer } from "@/lib/ingestion/matching";

/**
 * Customer Resolution Queue
 * Surfaces ingestion events with unresolved customer references.
 * Runs matching engine to suggest canonical customer entities.
 */

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");

    // Find parsed messages with customer guesses that haven't been linked
    const unlinkedMessages = await prisma.parsedMessage.findMany({
      where: {
        ingestionLinks: { none: {} },
        confidenceScore: { lt: 80 },
      },
      include: {
        ingestionEvent: {
          select: {
            id: true,
            sourceRecordType: true,
            eventKind: true,
            receivedAt: true,
            source: { select: { sourceType: true } },
          },
        },
        extractedEntities: {
          where: { entityType: { in: ["SENDER_EMAIL", "SENDER_PHONE", "SUPPLIER_NAME"] } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // For each, try to resolve customer
    const items = await Promise.all(
      unlinkedMessages.map(async (msg) => {
        const structured = msg.structuredData as Record<string, unknown> | null;
        const customerGuess = (structured?.customerGuess as string) || null;

        const suggestions = customerGuess ? await matchCustomer(customerGuess) : [];

        return {
          parsedMessageId: msg.id,
          eventId: msg.ingestionEvent.id,
          sourceType: msg.ingestionEvent.source.sourceType,
          messageType: msg.messageType,
          customerGuess,
          confidence: msg.confidenceScore ? Number(msg.confidenceScore) : null,
          suggestions,
          extractedEntities: msg.extractedEntities,
        };
      })
    );

    // Only return items that actually have a customer guess
    const filtered = items.filter((i) => i.customerGuess);

    return Response.json(filtered);
  } catch (error) {
    console.error("Failed to fetch customer resolution queue:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { rawCustomerText } = await request.json();
    if (!rawCustomerText) {
      return Response.json({ error: "rawCustomerText required" }, { status: 400 });
    }

    const suggestions = await matchCustomer(rawCustomerText);
    return Response.json({ rawCustomerText, suggestions });
  } catch (error) {
    console.error("Customer matching failed:", error);
    return Response.json({ error: "Matching failed" }, { status: 500 });
  }
}
