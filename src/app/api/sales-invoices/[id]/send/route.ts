import { prisma } from "@/lib/prisma";
import { postSalesInvoice } from "@/lib/finance/gl-posting";
import { evaluateInvoiceSendGate } from "@/lib/sales/invoice-send-gate";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Parse override flag (caller can pass { overrideGate: true, overrideReason })
  let overrideGate = false;
  let overrideReason: string | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    overrideGate = body?.overrideGate === true;
    overrideReason = typeof body?.overrideReason === "string" ? body.overrideReason : null;
  } catch { /* no body — use defaults */ }

  // Gate: customer flags drive what evidence we need before send.
  const gate = await evaluateInvoiceSendGate(id);
  if (!gate.ok && !overrideGate) {
    return Response.json(
      {
        error: "INVOICE_SEND_BLOCKED",
        message: gate.message,
        missing: gate.missing,
        canOverride: true,
      },
      { status: 412 },
    );
  }

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const updated = await tx.salesInvoice.update({
        where: { id },
        data: { status: "SENT", issuedAt: new Date() },
        include: {
          ticket: true,
          customer: true,
          site: true,
          lines: true,
          poAllocations: true,
        },
      });
      await postSalesInvoice(updated.id, tx);

      if (overrideGate && !gate.ok) {
        await tx.ingestionAuditLog.create({
          data: {
            objectType: "SalesInvoice",
            objectId: id,
            actionType: "SEND_GATE_OVERRIDDEN",
            actor: "USER",
            newValueJson: { missing: gate.missing },
            reason: overrideReason ?? "manual override",
          },
        });
      }
      return updated;
    });

    return Response.json(invoice);
  } catch (error) {
    console.error("Failed to send sales invoice:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to send sales invoice" },
      { status: 500 }
    );
  }
}
