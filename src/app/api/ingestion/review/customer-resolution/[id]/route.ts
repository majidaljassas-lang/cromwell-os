import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

/**
 * Customer Resolution Actions
 * PATCH: confirm match to existing customer, or create new
 */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params; // parsedMessageId
    const body = await request.json();
    const { action, customerId, createAlias, aliasText, customerData, actor } = body as {
      action: "confirm" | "create_customer";
      customerId?: string;
      createAlias?: boolean;
      aliasText?: string;
      customerData?: { name: string; legalName?: string; paymentTerms?: string };
      actor?: string;
    };

    const parsedMsg = await prisma.parsedMessage.findUnique({
      where: { id },
      include: { ingestionEvent: true },
    });
    if (!parsedMsg) {
      return Response.json({ error: "Parsed message not found" }, { status: 404 });
    }

    const structured = parsedMsg.structuredData as Record<string, unknown> | null;
    const rawText = (aliasText || structured?.customerGuess || "") as string;

    let resolvedCustomerId: string;

    if (action === "confirm") {
      if (!customerId) return Response.json({ error: "customerId required" }, { status: 400 });
      resolvedCustomerId = customerId;
    } else if (action === "create_customer") {
      if (!customerData?.name) return Response.json({ error: "customerData.name required" }, { status: 400 });
      const newCustomer = await prisma.customer.create({
        data: {
          name: customerData.name,
          legalName: customerData.legalName,
          paymentTerms: customerData.paymentTerms,
        },
      });
      resolvedCustomerId = newCustomer.id;
    } else {
      return Response.json({ error: "Invalid action" }, { status: 400 });
    }

    // Create alias for future matching
    if (createAlias !== false && rawText) {
      await prisma.customerAlias.upsert({
        where: {
          customerId_aliasText: {
            customerId: resolvedCustomerId,
            aliasText: rawText.toLowerCase().trim(),
          },
        },
        create: {
          customerId: resolvedCustomerId,
          aliasText: rawText.toLowerCase().trim(),
          sourceType: undefined,
        },
        update: { isActive: true },
      });
    }

    await logAudit({
      objectType: "CustomerResolution",
      objectId: id,
      actionType: `CUSTOMER_${action.toUpperCase()}`,
      actor,
      previousValue: { rawText },
      newValue: { customerId: resolvedCustomerId, action },
    });

    return Response.json({ resolved: true, customerId: resolvedCustomerId });
  } catch (error) {
    console.error("Customer resolution failed:", error);
    return Response.json({ error: "Resolution failed" }, { status: 500 });
  }
}
