/**
 * POST /api/finance/backlog/action
 *
 * Single endpoint for all backlog actions: promote / merge / reject.
 *
 * Body:
 *   { type: "BILL" | "INVOICE" | "PAYMENT" | "CONTACT",
 *     action: "PROMOTE" | "MERGE" | "REJECT",
 *     stagingId: string,
 *     // Promote args (per type):
 *     supplierId?: string,
 *     customerId?: string,
 *     siteId?: string,
 *     ticketId?: string,
 *     salesInvoiceId?: string,
 *     supplierBillId?: string,
 *     bankAccountId?: string,
 *     asKind?: "CUSTOMER" | "SUPPLIER",
 *     // Merge args:
 *     mergeIntoKind?: "CUSTOMER" | "SUPPLIER",
 *     mergeIntoId?: string,
 *     // Reject:
 *     reason?: string }
 */
import {
  promoteBill,
  promoteInvoice,
  promotePayment,
  promoteContact,
  mergeContact,
  rejectStaging,
} from "@/lib/finance/backlog-promote";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, string | undefined>;
    const { type, action, stagingId } = body;
    if (!type || !action || !stagingId) {
      return Response.json(
        { error: "type, action, stagingId required" },
        { status: 400 }
      );
    }

    if (action === "REJECT") {
      const result = await rejectStaging({
        type: type as "BILL" | "INVOICE" | "PAYMENT" | "CONTACT",
        stagingId,
        reason: body.reason ?? "Rejected via Backlog",
      });
      return Response.json({ ok: true, action: "REJECTED", id: result.id });
    }

    if (type === "BILL" && action === "PROMOTE") {
      if (!body.supplierId)
        return Response.json({ error: "supplierId required" }, { status: 400 });
      const result = await promoteBill({
        zohoBillStagingId: stagingId,
        supplierId: body.supplierId,
      });
      return Response.json({ ok: true, action: "PROMOTED", supplierBillId: result.id });
    }

    if (type === "INVOICE" && action === "PROMOTE") {
      if (!body.customerId || !body.ticketId || !body.siteId) {
        return Response.json(
          { error: "customerId, ticketId, siteId required for invoice promotion" },
          { status: 400 }
        );
      }
      const result = await promoteInvoice({
        zohoInvoiceStagingId: stagingId,
        customerId: body.customerId,
        ticketId: body.ticketId,
        siteId: body.siteId,
      });
      return Response.json({ ok: true, action: "PROMOTED", salesInvoiceId: result.id });
    }

    if (type === "PAYMENT" && action === "PROMOTE") {
      const result = await promotePayment({
        zohoPaymentStagingId: stagingId,
        salesInvoiceId: body.salesInvoiceId,
        supplierBillId: body.supplierBillId,
        bankAccountId: body.bankAccountId,
      });
      return Response.json({ ok: true, action: "PROMOTED", ...result });
    }

    if (type === "CONTACT" && action === "PROMOTE") {
      if (!body.asKind)
        return Response.json({ error: "asKind required (CUSTOMER|SUPPLIER)" }, { status: 400 });
      const result = await promoteContact({
        zohoContactStagingId: stagingId,
        asKind: body.asKind as "CUSTOMER" | "SUPPLIER",
      });
      return Response.json({ ok: true, action: "PROMOTED", ...result });
    }

    if (type === "CONTACT" && action === "MERGE") {
      if (!body.mergeIntoKind || !body.mergeIntoId)
        return Response.json(
          { error: "mergeIntoKind, mergeIntoId required for merge" },
          { status: 400 }
        );
      const result = await mergeContact({
        zohoContactStagingId: stagingId,
        mergeIntoKind: body.mergeIntoKind as "CUSTOMER" | "SUPPLIER",
        mergeIntoId: body.mergeIntoId,
      });
      return Response.json({ ok: true, action: "MERGED", ...result });
    }

    return Response.json(
      { error: `Unsupported action: ${type}/${action}` },
      { status: 400 }
    );
  } catch (e) {
    console.error("/api/finance/backlog/action POST failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}
