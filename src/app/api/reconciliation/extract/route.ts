import { prisma } from "@/lib/prisma";
import { normalizeProduct, extractQtyUnit, convertToBase } from "@/lib/reconciliation/normalizer";

/**
 * POST: Extract order lines from a backlog message into an order thread.
 *
 * Status = MESSAGE_LINKED only. No financial status until invoices/bills linked.
 * Every value traceable to the source message. No assumptions.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messageId, caseId, threadLabel, confirm } = body;

    if (!messageId || !caseId) {
      return Response.json({ error: "messageId and caseId required" }, { status: 400 });
    }

    const msg = await prisma.backlogMessage.findUnique({ where: { id: messageId } });
    if (!msg) return Response.json({ error: "Message not found" }, { status: 404 });

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
    }> = [];

    for (const line of lines) {
      const trimmed = line.replace(/^[•\-\s]+/, "").trim();
      if (trimmed.length < 5) continue;
      const qtyUnit = extractQtyUnit(trimmed);
      if (!qtyUnit) continue;
      const { normalized, category, confidence } = normalizeProduct(trimmed);
      const base = convertToBase(normalized, qtyUnit.qty, qtyUnit.unit);
      candidates.push({ rawText: trimmed, normalizedProduct: normalized, category, qty: qtyUnit.qty, unit: qtyUnit.unit, qtyBase: base.qtyBase, baseUnit: base.baseUnit, confidence });
    }

    if (!confirm) {
      return Response.json({ preview: true, messageId, sender: msg.sender, timestamp: msg.parsedTimestamp, totalLines: lines.length, candidates });
    }

    const thread = await prisma.backlogOrderThread.create({
      data: {
        caseId,
        label: threadLabel || `${msg.sender} — ${new Date(msg.parsedTimestamp).toLocaleDateString("en-GB")}`,
        description: msg.rawText.slice(0, 200),
        messageIds: [messageId],
      },
    });

    const created = [];
    for (const c of candidates) {
      const tl = await prisma.backlogTicketLine.create({
        data: {
          caseId,
          orderThreadId: thread.id,
          sourceMessageId: messageId,
          date: msg.parsedTimestamp,
          sender: msg.sender,
          rawText: c.rawText,
          normalizedProduct: c.normalizedProduct,
          requestedQty: c.qty,
          requestedUnit: c.unit,
          requestedQtyBase: c.qtyBase,
          baseUnit: c.baseUnit,
          status: "MESSAGE_LINKED",
        },
      });
      created.push(tl);
    }

    return Response.json({ confirmed: true, threadId: thread.id, threadLabel: thread.label, created: created.length, ticketLines: created }, { status: 201 });
  } catch (error) {
    console.error("Extraction failed:", error);
    return Response.json({ error: "Extraction failed" }, { status: 500 });
  }
}
