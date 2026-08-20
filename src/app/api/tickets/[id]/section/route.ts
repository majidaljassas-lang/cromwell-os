import { prisma } from "@/lib/prisma";
import { resequenceLines } from "@/lib/tickets/resequence-lines";

/**
 * POST /api/tickets/[id]/section
 *
 * Fully automatic section flow:
 * 1. Parses materials text into individual items (qty + description + optional code)
 * 2. Creates ticket lines, all tagged with the section label
 * 3. Logs EXTRA_ORDER_ADDED event per line
 *
 * Body: { label: string, source: string, materials: string, payingCustomerId: string }
 */

function parseMaterials(text: string): Array<{ description: string; qty: number; unit: string; productCode?: string }> {
  const lines = text
    .split(/\n|,\s*(?=\d)/)
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((line) => {
    let qty = 1;
    let unit = "EA";
    let description = line;
    let productCode: string | undefined;

    // Strip a trailing product code like "(DUO20)" / "[DUO20]" — keep only the description
    const trailingCode = line.match(/^(.+?)\s*[(\[]([A-Za-z][A-Za-z0-9_-]*)[)\]]\s*$/);
    if (trailingCode) {
      description = trailingCode[1].trim();
      productCode = trailingCode[2];
    } else {
      description = line;
    }

    // Treat the unicode multiplication sign × the same as `x`.
    const norm = description.replace(/×/g, "x");

    // Pattern: "description - QTY no./ea/pcs/lengths/packs"
    const trailingQty = norm.match(/^(.+?)\s*[-–—]\s*(\d+)\s*(no\.?|ea\.?|pcs?|lengths?|packs?|sets?|lot|rolls?|metres?|m\b)?\s*\.?\s*$/i);
    if (trailingQty) {
      return {
        description: trailingQty[1].trim(),
        qty: parseInt(trailingQty[2], 10),
        unit: resolveUnit(trailingQty[3]),
        productCode,
      };
    }

    // Pattern: "QTY x description" or "QTY no. description" (also handles "QTY × description")
    const leadingQty = norm.match(/^(\d+)\s*(?:x|no\.?|ea\.?|pcs?|of)\s+(.+)$/i);
    if (leadingQty) {
      return {
        description: leadingQty[2].trim(),
        qty: parseInt(leadingQty[1], 10),
        unit,
        productCode,
      };
    }

    // Pattern: "description x QTY" or "description (QTY)"
    const endQty = norm.match(/^(.+?)\s*(?:x\s*|[(\[])(\d+)\s*[)\]]?\s*$/i);
    if (endQty) {
      return {
        description: endQty[1].trim(),
        qty: parseInt(endQty[2], 10),
        unit,
        productCode,
      };
    }

    return { description, qty, unit, productCode };
  });
}

function resolveUnit(raw?: string): string {
  if (!raw) return "EA";
  const u = raw.toLowerCase().replace(/\./g, "");
  if (/length/.test(u)) return "LENGTH";
  if (/pack/.test(u)) return "PACK";
  if (/set/.test(u)) return "SET";
  if (/lot/.test(u)) return "LOT";
  if (/m(etre)?s?$/.test(u)) return "M";
  if (/roll/.test(u)) return "EA";
  return "EA";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;
  try {
    const { label, source, materials, payingCustomerId } = await request.json();

    if (!label?.trim()) {
      return Response.json({ error: "Label is required" }, { status: 400 });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });

    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Parse materials into line items
    const items = parseMaterials(materials || "");

    if (items.length === 0) {
      return Response.json({ error: "No items could be parsed from the materials text" }, { status: 400 });
    }

    // Create ticket lines — every line gets the sectionLabel so the
    // renderer always shows them in one block, even after re-sorting.
    const createdLines = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const line = await prisma.ticketLine.create({
        data: {
          ticketId,
          lineType: "MATERIAL",
          description: item.description,
          qty: item.qty,
          unit: item.unit as any,
          productCode: item.productCode,
          payingCustomerId,
          status: "CAPTURED",
          sectionLabel: label.trim(),
        },
      });

      await prisma.event.create({
        data: {
          ticketId,
          ticketLineId: line.id,
          eventType: "EXTRA_ORDER_ADDED",
          timestamp: new Date(),
          sourceRef: source || "CALL",
          notes: `${label.trim()}: ${item.description} x${item.qty} (via ${source || "CALL"})`,
        },
      });

      createdLines.push(line);
    }

    // Compact every section into a single contiguous block
    await resequenceLines(ticketId);

    return Response.json({
      ok: true,
      sectionLabel: label.trim(),
      linesCreated: createdLines.length,
      lines: createdLines,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to add section:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to add section" }, { status: 500 });
  }
}
