import { prisma } from "@/lib/prisma";
import path from "path";
import fs from "fs";

/**
 * POST /api/tickets/[id]/log-purchase
 *
 * Log a supplier order acknowledgement against a ticket.
 * Accepts multipart form data with optional file upload.
 *
 * Fields: supplierName, orderRef, totalNet, totalVat, notes, file (optional)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;
  try {
    const formData = await request.formData();
    const supplierName = formData.get("supplierName") as string;
    const orderRef = formData.get("orderRef") as string;
    const totalNet = Number(formData.get("totalNet") || 0);
    const totalVat = Number(formData.get("totalVat") || 0);
    const notes = formData.get("notes") as string | null;
    const file = formData.get("file") as File | null;

    if (!supplierName?.trim() || !orderRef?.trim()) {
      return Response.json({ error: "Supplier name and order reference are required" }, { status: 400 });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, title: true },
    });

    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Save uploaded file if present
    let filePath: string | null = null;
    let fileName: string | null = null;
    if (file && file.size > 0) {
      const outputDir = path.join(process.cwd(), "public", "procurement-uploads");
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const ext = file.name.split(".").pop() || "pdf";
      fileName = `${orderRef.replace(/[^a-zA-Z0-9-]/g, "_")}_${Date.now()}.${ext}`;
      filePath = `/procurement-uploads/${fileName}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(path.join(outputDir, fileName), buffer);
    }

    // Create procurement order record as acknowledgement
    // Find or create supplier
    let supplier = await prisma.supplier.findFirst({
      where: { name: { contains: supplierName.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: { name: supplierName.trim() },
      });
    }
    const supplierId = supplier.id;

    const po = await prisma.procurementOrder.create({
      data: {
        ticketId,
        supplierId,
        poNo: orderRef.trim(),
        supplierRef: orderRef.trim(),
        status: "ACKNOWLEDGED",
        totalCostExpected: totalNet,
        siteRef: notes || undefined,
      },
    });

    // Log event
    const totalInc = totalNet + totalVat;
    await prisma.event.create({
      data: {
        ticketId,
        eventType: "PURCHASE_ORDER_SENT",
        timestamp: new Date(),
        sourceRef: orderRef.trim(),
        notes: `Order acknowledgement from ${supplierName.trim()} — Ref: ${orderRef.trim()} — £${totalNet.toFixed(2)} + VAT £${totalVat.toFixed(2)} = £${totalInc.toFixed(2)}${filePath ? ` [Document attached]` : ""}`,
      },
    });

    return Response.json({
      ok: true,
      procurementOrderId: po.id,
      supplierName: supplierName.trim(),
      orderRef: orderRef.trim(),
      totalNet,
      totalVat,
      filePath,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to log purchase:", error);
    return Response.json({ error: "Failed to log purchase" }, { status: 500 });
  }
}
