import { prisma } from "@/lib/prisma";

/**
 * POST /api/tickets/[id]/section
 *
 * Fully automatic section flow:
 * 1. Parses materials text into individual items (qty + description)
 * 2. Creates ticket lines (first one gets sectionLabel)
 * 3. Logs EXTRA_ORDER_ADDED event per line
 *
 * Body: { label: string, source: string, materials: string, payingCustomerId: string }
 */

function parseMaterials(text: string): Array<{ description: string; qty: number; unit: string }> {
  const lines = text
    .split(/\n|,\s*(?=\d)/)
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((line) => {
    // Try patterns like: "35mm Compression Valve - 2 no." or "2 x 35mm Valve" or "35mm Valve x 2"
    let qty = 1;
    let unit = "EA";
    let description = line;

    // Pattern: "description - QTY no./ea/pcs/lengths/packs"
    const trailingQty = line.match(/^(.+?)\s*[-–]\s*(\d+)\s*(no\.?|ea\.?|pcs?|lengths?|packs?|sets?|lot|rolls?|metres?|m\b)?\s*\.?\s*$/i);
    if (trailingQty) {
      description = trailingQty[1].trim();
      qty = parseInt(trailingQty[2], 10);
      unit = resolveUnit(trailingQty[3]);
      return { description, qty, unit };
    }

    // Pattern: "QTY x description" or "QTY no. description"
    const leadingQty = line.match(/^(\d+)\s*(?:x|no\.?|ea\.?|pcs?|of)?\s+(.+)$/i);
    if (leadingQty) {
      qty = parseInt(leadingQty[1], 10);
      description = leadingQty[2].trim();
      return { description, qty, unit };
    }

    // Pattern: "description x QTY" or "description (QTY)"
    const endQty = line.match(/^(.+?)\s*(?:x\s*|[(\[])(\d+)\s*[)\]]?\s*$/i);
    if (endQty) {
      description = endQty[1].trim();
      qty = parseInt(endQty[2], 10);
      return { description, qty, unit };
    }

    return { description, qty, unit };
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

    // Create ticket lines — first one gets the sectionLabel
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
          payingCustomerId,
          status: "CAPTURED",
          sectionLabel: i === 0 ? label.trim() : undefined,
        },
      });

      // Log event for each line
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
