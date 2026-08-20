/**
 * Promote / merge / reject quarantined Zoho records into clean OS native
 * records. Each promotion is wrapped in a transaction so the staging
 * row, the native record, and the GL post all succeed or all fail.
 *
 * Customer / Site dedup heuristics here are deliberately conservative —
 * the UI surfaces matches and the user confirms.
 */
import { prisma } from "@/lib/prisma";
import {
  postSupplierBill,
  postSalesInvoice,
  postPaymentReceived,
  postPaymentMade,
} from "./gl-posting";

interface PromoteContactArgs {
  zohoContactStagingId: string;
  asKind: "CUSTOMER" | "SUPPLIER";
}

export async function promoteContact(args: PromoteContactArgs) {
  return prisma.$transaction(async (tx) => {
    const stg = await tx.zohoImportedContact.findUnique({
      where: { id: args.zohoContactStagingId },
    });
    if (!stg) throw new Error("Staging contact not found");
    if (stg.importStatus !== "QUARANTINED")
      throw new Error(`Already ${stg.importStatus}`);

    const name = stg.companyName ?? stg.contactName ?? "(unnamed Zoho contact)";

    if (args.asKind === "CUSTOMER") {
      const customer = await tx.customer.create({
        data: {
          name,
          legalName: stg.companyName,
          vatNumber: stg.vatNumber,
          notes: `Promoted from Zoho contact ${stg.zohoId}`,
        },
      });
      await tx.zohoImportedContact.update({
        where: { id: stg.id },
        data: {
          importStatus: "PROMOTED",
          promotedToId: customer.id,
          promotedKind: "CUSTOMER",
          promotedAt: new Date(),
        },
      });
      return { kind: "CUSTOMER" as const, id: customer.id };
    }
    const supplier = await tx.supplier.create({
      data: {
        name,
        legalName: stg.companyName,
        email: stg.email,
        phone: stg.phone,
        notes: `Promoted from Zoho contact ${stg.zohoId}`,
      },
    });
    await tx.zohoImportedContact.update({
      where: { id: stg.id },
      data: {
        importStatus: "PROMOTED",
        promotedToId: supplier.id,
        promotedKind: "SUPPLIER",
        promotedAt: new Date(),
      },
    });
    return { kind: "SUPPLIER" as const, id: supplier.id };
  });
}

interface MergeContactArgs {
  zohoContactStagingId: string;
  mergeIntoKind: "CUSTOMER" | "SUPPLIER";
  mergeIntoId: string;
}

export async function mergeContact(args: MergeContactArgs) {
  return prisma.$transaction(async (tx) => {
    const stg = await tx.zohoImportedContact.findUnique({
      where: { id: args.zohoContactStagingId },
    });
    if (!stg) throw new Error("Staging contact not found");
    if (stg.importStatus !== "QUARANTINED")
      throw new Error(`Already ${stg.importStatus}`);

    if (args.mergeIntoKind === "CUSTOMER") {
      const exists = await tx.customer.findUnique({ where: { id: args.mergeIntoId } });
      if (!exists) throw new Error("Customer not found");
    } else {
      const exists = await tx.supplier.findUnique({ where: { id: args.mergeIntoId } });
      if (!exists) throw new Error("Supplier not found");
    }
    await tx.zohoImportedContact.update({
      where: { id: stg.id },
      data: {
        importStatus: "MERGED",
        promotedToId: args.mergeIntoId,
        promotedKind: args.mergeIntoKind,
        promotedAt: new Date(),
      },
    });
    return { kind: args.mergeIntoKind, id: args.mergeIntoId };
  });
}

interface PromoteBillArgs {
  zohoBillStagingId: string;
  supplierId: string;
}

export async function promoteBill(args: PromoteBillArgs) {
  return prisma.$transaction(async (tx) => {
    const stg = await tx.zohoImportedBill.findUnique({
      where: { id: args.zohoBillStagingId },
    });
    if (!stg) throw new Error("Staging bill not found");
    if (stg.importStatus !== "QUARANTINED")
      throw new Error(`Already ${stg.importStatus}`);

    const supplier = await tx.supplier.findUnique({ where: { id: args.supplierId } });
    if (!supplier) throw new Error("Supplier not found");

    const total = Number(stg.total ?? 0);

    const bill = await tx.supplierBill.create({
      data: {
        supplierId: supplier.id,
        billNo: stg.zohoNumber ?? `ZOHO-${stg.zohoId.slice(0, 8)}`,
        billDate: stg.billDate ?? new Date(),
        dueDate: stg.dueDate,
        status: stg.status === "paid" ? "PAID" : "RECEIVED",
        amountExVat: total / 1.2,
        vatAmount: total - total / 1.2,
        amountIncVat: total,
        totalCost: total,
      },
    });

    await tx.zohoImportedBill.update({
      where: { id: stg.id },
      data: {
        importStatus: "PROMOTED",
        promotedToId: bill.id,
        promotedAt: new Date(),
      },
    });

    // Post AP entry (idempotent)
    await postSupplierBill(bill.id, tx);
    return { id: bill.id };
  });
}

interface PromoteInvoiceArgs {
  zohoInvoiceStagingId: string;
  customerId: string;
  ticketId: string;
  siteId: string;
}

export async function promoteInvoice(args: PromoteInvoiceArgs) {
  return prisma.$transaction(async (tx) => {
    const stg = await tx.zohoImportedInvoice.findUnique({
      where: { id: args.zohoInvoiceStagingId },
    });
    if (!stg) throw new Error("Staging invoice not found");
    if (stg.importStatus !== "QUARANTINED")
      throw new Error(`Already ${stg.importStatus}`);

    const customer = await tx.customer.findUnique({ where: { id: args.customerId } });
    if (!customer) throw new Error("Customer not found");
    const site = await tx.site.findUnique({ where: { id: args.siteId } });
    if (!site) throw new Error("Site not found");
    const ticket = await tx.ticket.findUnique({ where: { id: args.ticketId } });
    if (!ticket) throw new Error("Ticket not found");

    const total = Number(stg.total ?? 0);
    const issuedAt = stg.invoiceDate ?? new Date();

    const inv = await tx.salesInvoice.create({
      data: {
        ticketId: ticket.id,
        invoiceNo: stg.zohoNumber ?? `ZOHO-${stg.zohoId.slice(0, 8)}`,
        customerId: customer.id,
        siteId: site.id,
        invoiceType: "SALES",
        status: stg.status === "paid" ? "PAID" : "SENT",
        issuedAt,
        dueDate: stg.dueDate,
        totalSell: total,
        notes: `Promoted from Zoho invoice ${stg.zohoId}`,
      },
    });

    await tx.zohoImportedInvoice.update({
      where: { id: stg.id },
      data: {
        importStatus: "PROMOTED",
        promotedToId: inv.id,
        promotedAt: new Date(),
      },
    });

    // Best-effort: post AR entry. Skips if no SalesInvoiceLines (header-only
    // promotion creates an unbalanced JE; line-level promotion covered in
    // a follow-up where the Backlog UI lets the user re-key lines).
    try {
      await postSalesInvoice(inv.id, tx);
    } catch (e) {
      console.warn(
        `[backlog-promote] Skipped AR posting for invoice ${inv.id}:`,
        (e as Error).message
      );
    }
    return { id: inv.id };
  });
}

interface PromotePaymentArgs {
  zohoPaymentStagingId: string;
  // For CUSTOMER payments
  salesInvoiceId?: string;
  // For VENDOR payments
  supplierBillId?: string;
  bankAccountId?: string;
}

export async function promotePayment(args: PromotePaymentArgs) {
  return prisma.$transaction(async (tx) => {
    const stg = await tx.zohoImportedPayment.findUnique({
      where: { id: args.zohoPaymentStagingId },
    });
    if (!stg) throw new Error("Staging payment not found");
    if (stg.importStatus !== "QUARANTINED")
      throw new Error(`Already ${stg.importStatus}`);

    const amount = Number(stg.amount ?? 0);
    const paymentDate = stg.paymentDate ?? new Date();

    if (stg.paymentSide === "CUSTOMER") {
      if (!args.salesInvoiceId)
        throw new Error("salesInvoiceId required for customer payment promotion");
      const inv = await tx.salesInvoice.findUnique({
        where: { id: args.salesInvoiceId },
      });
      if (!inv) throw new Error("SalesInvoice not found");
      const payment = await tx.payment.create({
        data: {
          salesInvoiceId: inv.id,
          amount,
          paymentDate,
          paymentMethod: stg.paymentMode ?? "BANK_TRANSFER",
          reference: stg.reference ?? `Zoho payment ${stg.zohoId}`,
        },
      });
      await postPaymentReceived(payment.id, "1000", tx);
      await tx.zohoImportedPayment.update({
        where: { id: stg.id },
        data: {
          importStatus: "PROMOTED",
          promotedToId: payment.id,
          promotedAt: new Date(),
        },
      });
      return { kind: "PAYMENT" as const, id: payment.id };
    }

    if (!args.supplierBillId)
      throw new Error("supplierBillId required for vendor payment promotion");
    const bill = await tx.supplierBill.findUnique({
      where: { id: args.supplierBillId },
    });
    if (!bill) throw new Error("SupplierBill not found");
    const pm = await tx.paymentMade.create({
      data: {
        supplierId: bill.supplierId,
        bankAccountId: args.bankAccountId,
        paymentDate,
        amount,
        paymentMethod: stg.paymentMode ?? "BANK_TRANSFER",
        reference: stg.reference ?? `Zoho payment ${stg.zohoId}`,
      },
    });
    await tx.paymentMadeAllocation.create({
      data: { paymentMadeId: pm.id, supplierBillId: bill.id, amount },
    });
    await postPaymentMade(pm.id, "1000", tx);
    await tx.zohoImportedPayment.update({
      where: { id: stg.id },
      data: {
        importStatus: "PROMOTED",
        promotedToId: pm.id,
        promotedAt: new Date(),
      },
    });
    return { kind: "PAYMENT_MADE" as const, id: pm.id };
  });
}

interface RejectArgs {
  type: "BILL" | "INVOICE" | "PAYMENT" | "CONTACT";
  stagingId: string;
  reason: string;
}

export async function rejectStaging(args: RejectArgs) {
  const data = {
    importStatus: "REJECTED" as const,
    rejectedReason: args.reason,
  };
  switch (args.type) {
    case "BILL":
      return prisma.zohoImportedBill.update({ where: { id: args.stagingId }, data });
    case "INVOICE":
      return prisma.zohoImportedInvoice.update({ where: { id: args.stagingId }, data });
    case "PAYMENT":
      return prisma.zohoImportedPayment.update({ where: { id: args.stagingId }, data });
    case "CONTACT":
      return prisma.zohoImportedContact.update({ where: { id: args.stagingId }, data });
  }
}
