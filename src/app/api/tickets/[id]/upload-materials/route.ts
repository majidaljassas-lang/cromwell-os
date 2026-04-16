/**
 * POST /api/tickets/:id/upload-materials
 *
 * Upload an Excel/CSV file → parse → create ticket lines.
 * Accepts multipart form data with a file field.
 *
 * Supports:
 * - .xlsx / .xls (Excel)
 * - .csv
 *
 * Auto-detects columns: looks for description, qty, unit headers.
 * Falls back to positional: first text column = description, first number = qty.
 */

import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: { id: true, ticketNo: true, payingCustomerId: true },
  });
  if (!ticket) return Response.json({ error: "ticket not found" }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return Response.json({ error: "no file uploaded" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];

  if (data.length < 2) {
    return Response.json({ error: "file is empty or has no data rows" }, { status: 400 });
  }

  // Find the header row and column indices
  let descCol = -1;
  let qtyCol = -1;
  let unitCol = -1;
  let remarksCol = -1;
  let headerRow = -1;

  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] ?? "").toLowerCase().trim();
      if (cell.includes("description") || cell.includes("item") && cell.length < 20) {
        if (descCol === -1) { descCol = j; headerRow = i; }
      }
      if (cell.includes("qty") || cell.includes("quantity")) qtyCol = j;
      if (cell === "unit" || cell === "units" || cell === "uom") unitCol = j;
      if (cell.includes("remark") || cell.includes("note")) remarksCol = j;
    }
    if (descCol >= 0) break;
  }

  // Fallback: if no header found, scan for pattern
  if (descCol === -1) {
    // Find first row with a text cell + a number cell
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (!row) continue;
      for (let j = 0; j < row.length; j++) {
        const val = row[j];
        if (typeof val === "string" && val.trim().length > 5 && descCol === -1) descCol = j;
        if (typeof val === "number" && val > 0 && qtyCol === -1 && j !== descCol) qtyCol = j;
      }
      if (descCol >= 0 && qtyCol >= 0) { headerRow = i - 1; break; }
    }
  }

  if (descCol === -1) {
    return Response.json({ error: "could not find description column" }, { status: 400 });
  }

  // Parse data rows
  const startRow = headerRow + 1;
  const lines: Array<{ description: string; qty: number; unit: string; notes: string }> = [];

  for (let i = startRow; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;

    const desc = String(row[descCol] ?? "").trim().replace(/\n/g, " ").replace(/\s+/g, " ");
    if (!desc || desc.length < 3) continue;

    let qty = qtyCol >= 0 ? Number(row[qtyCol]) || 0 : 1;
    if (qty === 0) {
      // Try to find a number in adjacent cells
      for (let j = descCol + 1; j < Math.min(descCol + 5, row.length); j++) {
        const v = Number(row[j]);
        if (v > 0 && v < 100000) { qty = v; break; }
      }
    }
    if (qty === 0) qty = 1;

    const unit = unitCol >= 0 ? String(row[unitCol] ?? "").trim() : "";
    const notes = remarksCol >= 0 ? String(row[remarksCol] ?? "").trim() : "";

    lines.push({ description: desc, qty, unit, notes });
  }

  if (lines.length === 0) {
    return Response.json({ error: "no data rows found in file" }, { status: 400 });
  }

  // Create ticket lines
  let created = 0;
  for (const line of lines) {
    await prisma.ticketLine.create({
      data: {
        ticketId: ticket.id,
        lineType: "MATERIAL",
        description: line.description,
        qty: line.qty,
        unit: "EA",
        payingCustomerId: ticket.payingCustomerId,
        status: "CAPTURED",
        internalNotes: [line.unit && line.unit !== "item" ? `Unit: ${line.unit}` : "", line.notes].filter(Boolean).join(" | ") || null,
      },
    });
    created++;
  }

  // Log event
  await prisma.event.create({
    data: {
      ticketId: ticket.id,
      eventType: "COMMS_RECEIVED",
      timestamp: new Date(),
      notes: `Materials list uploaded: ${file.name} — ${created} lines created`,
    },
  });

  return Response.json({
    ok: true,
    fileName: file.name,
    linesCreated: created,
    preview: lines.slice(0, 5).map((l) => `${l.qty}x ${l.description.slice(0, 50)}`),
  });
}
