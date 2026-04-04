import { prisma } from "@/lib/prisma";
import { normalizeProduct, extractQtyUnit, convertToBase } from "@/lib/reconciliation/normalizer";

/**
 * POST: Extract ticket lines from a backlog message.
 * Body: { messageId: string, caseId: string }
 *
 * Parses each line of the message's rawText into ticket line candidates.
 * User reviews before confirming.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messageId, caseId, confirm } = body;

    if (!messageId || !caseId) {
      return Response.json({ error: "messageId and caseId required" }, { status: 400 });
    }

    const msg = await prisma.backlogMessage.findUnique({ where: { id: messageId } });
    if (!msg) return Response.json({ error: "Message not found" }, { status: 404 });

    // Parse each line of the message
    const lines = msg.rawText.split("\n").filter((l) => l.trim());
    const candidates: Array<{
      rawText: string;
      normalizedProduct: string;
      category: string;
      qty: number;
      unit: string;
      qtyBase: number;
      baseUnit: string;
      confidence: number;
      notes: string | null;
    }> = [];

    for (const line of lines) {
      const trimmed = line.replace(/^[•\-\s]+/, "").trim();
      if (trimmed.length < 5) continue;

      const qtyUnit = extractQtyUnit(trimmed);
      if (!qtyUnit) continue; // Skip lines without quantities

      const { normalized, category, confidence } = normalizeProduct(trimmed);
      if (normalized === "UNKNOWN" && confidence === 0) continue;

      const base = convertToBase(normalized, qtyUnit.qty, qtyUnit.unit);

      candidates.push({
        rawText: trimmed,
        normalizedProduct: normalized,
        category,
        qty: qtyUnit.qty,
        unit: qtyUnit.unit,
        qtyBase: base.qtyBase,
        baseUnit: base.baseUnit,
        confidence,
        notes: null,
      });
    }

    if (!confirm) {
      return Response.json({
        preview: true,
        messageId,
        sender: msg.sender,
        timestamp: msg.parsedTimestamp,
        totalLines: lines.length,
        candidates,
      });
    }

    // Confirm: create BacklogTicketLines
    const created = [];
    for (const c of candidates) {
      const tl = await prisma.backlogTicketLine.create({
        data: {
          caseId,
          sourceMessageId: messageId,
          date: msg.parsedTimestamp,
          sender: msg.sender,
          rawText: c.rawText,
          normalizedProduct: c.normalizedProduct,
          requestedQty: c.qty,
          requestedUnit: c.unit,
          requestedQtyBase: c.qtyBase,
          baseUnit: c.baseUnit,
          notes: c.notes,
          status: "UNMATCHED",
        },
      });
      created.push(tl);
    }

    return Response.json({
      confirmed: true,
      created: created.length,
      ticketLines: created,
    }, { status: 201 });
  } catch (error) {
    console.error("Extraction failed:", error);
    return Response.json({ error: "Extraction failed" }, { status: 500 });
  }
}
