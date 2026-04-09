import { prisma } from "@/lib/prisma";

/**
 * Auto-parse WhatsApp messages for line items.
 *
 * Scans recent ParsedMessages that have not yet had line items extracted,
 * applies enhanced regex patterns to find product references with quantities
 * and prices, and stores the extracted items in structuredData.
 *
 * Idempotent: messages already parsed for line items are skipped.
 */
export async function POST() {
  try {
    // Find ParsedMessages from WhatsApp that haven't been processed for line items
    const parsedMessages = await prisma.parsedMessage.findMany({
      where: {
        messageType: { in: ["WHATSAPP_MESSAGE", "WHATSAPP_VOICE"] },
        // Only look at messages that don't already have extracted line items
        NOT: {
          structuredData: {
            path: ["lineItemsExtracted"],
            equals: true,
          },
        },
      },
      include: {
        ingestionEvent: true,
      },
      take: 200,
      orderBy: { createdAt: "desc" },
    });

    const results = {
      processed: 0,
      withLineItems: 0,
      totalItemsExtracted: 0,
      details: [] as {
        parsedMessageId: string;
        itemCount: number;
        items: ExtractedLineItem[];
      }[],
    };

    for (const msg of parsedMessages) {
      const text = msg.extractedText;
      if (!text || text.trim().length < 5) {
        results.processed++;
        continue;
      }

      const items = extractLineItems(text);

      // Always mark as processed (even if no items found) to avoid re-processing
      const existingData = (msg.structuredData as Record<string, unknown>) || {};
      await prisma.parsedMessage.update({
        where: { id: msg.id },
        data: {
          structuredData: {
            ...existingData,
            lineItemsExtracted: true,
            extractedLineItems: items,
            lineItemsExtractedAt: new Date().toISOString(),
          },
        },
      });

      results.processed++;

      if (items.length > 0) {
        results.withLineItems++;
        results.totalItemsExtracted += items.length;
        results.details.push({
          parsedMessageId: msg.id,
          itemCount: items.length,
          items,
        });
      }
    }

    return Response.json({
      ...results,
      message: `Processed ${results.processed} messages, found line items in ${results.withLineItems} (${results.totalItemsExtracted} total items)`,
    });
  } catch (error) {
    console.error("WhatsApp line item parsing failed:", error);
    return Response.json(
      { error: "WhatsApp line item parsing failed" },
      { status: 500 }
    );
  }
}

// ─── Line item extraction ────────────────────────────────────────────────────

interface ExtractedLineItem {
  description: string;
  qty: number | null;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  productCode: string | null;
  confidence: number;
}

function extractLineItems(text: string): ExtractedLineItem[] {
  const items: ExtractedLineItem[] = [];
  const seen = new Set<string>();

  // Pattern 1: "10 x Basin Mixer Tap @ £45.00" or "10x Basin Mixer @ 45.00"
  const qtyPricePattern = /(\d+)\s*(?:x|×|no|nos)\s+(.+?)\s*(?:@|at)\s*£?([\d,.]+)/gi;
  let match;
  while ((match = qtyPricePattern.exec(text)) !== null) {
    const qty = parseInt(match[1]);
    const desc = match[2].trim();
    const unitPrice = parseFloat(match[3].replace(/,/g, ""));
    const key = `${desc.toLowerCase()}-${qty}-${unitPrice}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push({
        description: desc,
        qty,
        unit: "EA",
        unitPrice,
        lineTotal: qty * unitPrice,
        productCode: extractProductCode(desc),
        confidence: 90,
      });
    }
  }

  // Pattern 2: "Basin Mixer Tap x 10 @ £45" (description first)
  const descFirstPattern = /([A-Z][a-zA-Z\s/\-]{3,40})\s*(?:x|×)\s*(\d+)\s*(?:@|at)\s*£?([\d,.]+)/g;
  while ((match = descFirstPattern.exec(text)) !== null) {
    const desc = match[1].trim();
    const qty = parseInt(match[2]);
    const unitPrice = parseFloat(match[3].replace(/,/g, ""));
    const key = `${desc.toLowerCase()}-${qty}-${unitPrice}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push({
        description: desc,
        qty,
        unit: "EA",
        unitPrice,
        lineTotal: qty * unitPrice,
        productCode: extractProductCode(desc),
        confidence: 85,
      });
    }
  }

  // Pattern 3: List format "- 15mm Copper Pipe 3m length £12.50" or "• 22mm Elbow £3.20 x 5"
  const listPattern = /(?:^|\n)\s*[-•*]\s+(.+?)\s+£([\d,.]+)(?:\s*(?:x|×)\s*(\d+))?/gm;
  while ((match = listPattern.exec(text)) !== null) {
    const desc = match[1].trim();
    const price = parseFloat(match[2].replace(/,/g, ""));
    const qty = match[3] ? parseInt(match[3]) : 1;
    const key = `${desc.toLowerCase()}-${qty}-${price}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push({
        description: desc,
        qty,
        unit: "EA",
        unitPrice: price,
        lineTotal: qty * price,
        productCode: extractProductCode(desc),
        confidence: 75,
      });
    }
  }

  // Pattern 4: Qty + description without price "need 10 x 15mm copper elbows"
  const qtyOnlyPattern = /(?:need|order|get|send|supply|want)\s+(\d+)\s*(?:x|×|no|nos|pcs|of)?\s+(.{5,60}?)(?:\.|$|\n)/gi;
  while ((match = qtyOnlyPattern.exec(text)) !== null) {
    const qty = parseInt(match[1]);
    const desc = match[2].trim().replace(/\s+please$/i, "").trim();
    const key = `${desc.toLowerCase()}-${qty}`;
    if (!seen.has(key) && desc.length >= 3) {
      seen.add(key);
      items.push({
        description: desc,
        qty,
        unit: "EA",
        unitPrice: null,
        lineTotal: null,
        productCode: extractProductCode(desc),
        confidence: 60,
      });
    }
  }

  // Pattern 5: Product codes "ABC-12345" or supplier refs with quantities
  const codePattern = /([A-Z]{2,5}[-/]\d{3,8})\s*(?:x|×|qty)?\s*(\d+)?/g;
  while ((match = codePattern.exec(text)) !== null) {
    const code = match[1];
    const qty = match[2] ? parseInt(match[2]) : null;
    const key = `code-${code.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push({
        description: code,
        qty,
        unit: "EA",
        unitPrice: null,
        lineTotal: null,
        productCode: code,
        confidence: 55,
      });
    }
  }

  return items;
}

function extractProductCode(text: string): string | null {
  const codeMatch = text.match(/[A-Z]{2,5}[-/]\d{3,8}/);
  return codeMatch ? codeMatch[0] : null;
}
