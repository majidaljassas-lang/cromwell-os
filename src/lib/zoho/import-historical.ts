/**
 * One-shot historical import from Zoho Books → quarantine staging tables.
 *
 * - Idempotent on Zoho's stable ID (`zohoId`). Re-running updates the staging
 *   row in place; never creates duplicates.
 * - All records land in `importStatus = QUARANTINED`. The Backlog Cleanup
 *   workspace (F7) is the only path to promote them into clean OS native
 *   records that hit the GL.
 * - Pulls four entity types: Bills, Invoices, Customer Payments, Vendor
 *   Payments, Contacts. (Chart of Accounts isn't pulled — OS already has
 *   its own wholesaler COA.)
 *
 * Entry point: `runHistoricalImport(opts)`.
 */

import { prisma } from "@/lib/prisma";
import {
  listBills,
  listInvoices,
  listCustomerPayments,
  listVendorPayments,
  listContacts,
} from "./client";

export interface HistoricalImportResult {
  bills: { fetched: number; upserted: number };
  invoices: { fetched: number; upserted: number };
  customerPayments: { fetched: number; upserted: number };
  vendorPayments: { fetched: number; upserted: number };
  contacts: { fetched: number; upserted: number };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

interface HistoricalImportOpts {
  /** Cap pages per entity for testing. Omit for unbounded. */
  maxPages?: number;
  perPage?: number;
}

const DEFAULT_PER_PAGE = 200;

function asDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}
function asNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function asStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

async function importPaged<T extends { [k: string]: unknown }>(args: {
  fetcher: (page: number, perPage: number) => Promise<{ items: T[]; hasMore: boolean }>;
  upsert: (item: T) => Promise<"created" | "updated">;
  perPage: number;
  maxPages?: number;
}): Promise<{ fetched: number; upserted: number }> {
  let fetched = 0;
  let upserted = 0;
  let page = 1;
  while (true) {
    const { items, hasMore } = await args.fetcher(page, args.perPage);
    fetched += items.length;
    for (const item of items) {
      await args.upsert(item);
      upserted++;
    }
    if (!hasMore) break;
    if (args.maxPages && page >= args.maxPages) break;
    page++;
  }
  return { fetched, upserted };
}

export async function runHistoricalImport(
  opts: HistoricalImportOpts = {}
): Promise<HistoricalImportResult> {
  const startedAt = new Date();
  const perPage = opts.perPage ?? DEFAULT_PER_PAGE;

  // ── Bills ────────────────────────────────────────────────────────────────
  const bills = await importPaged({
    perPage,
    maxPages: opts.maxPages,
    fetcher: async (page, pp) => {
      const r = await listBills({ page, per_page: pp });
      return { items: r.bills, hasMore: !!r.page_context.has_more_page };
    },
    upsert: async (b) => {
      const zohoId = String(b.bill_id);
      const data = {
        zohoId,
        zohoNumber: asStr(b.bill_number),
        zohoVendorId: asStr(b.vendor_id),
        vendorName: asStr(b.vendor_name),
        billDate: asDate(b.date),
        dueDate: asDate(b.due_date),
        total: asNum(b.total),
        balance: asNum(b.balance),
        currencyCode: asStr(b.currency_code),
        status: asStr(b.status),
        payload: b as object,
      };
      const existing = await prisma.zohoImportedBill.findUnique({ where: { zohoId } });
      if (existing) {
        await prisma.zohoImportedBill.update({ where: { zohoId }, data });
        return "updated";
      }
      await prisma.zohoImportedBill.create({ data });
      return "created";
    },
  });

  // ── Invoices ─────────────────────────────────────────────────────────────
  const invoices = await importPaged({
    perPage,
    maxPages: opts.maxPages,
    fetcher: async (page, pp) => {
      const r = await listInvoices({ page, per_page: pp });
      return { items: r.invoices, hasMore: !!r.page_context.has_more_page };
    },
    upsert: async (i) => {
      const zohoId = String(i.invoice_id);
      const data = {
        zohoId,
        zohoNumber: asStr(i.invoice_number),
        zohoCustomerId: asStr(i.customer_id),
        customerName: asStr(i.customer_name),
        invoiceDate: asDate(i.date),
        dueDate: asDate(i.due_date),
        total: asNum(i.total),
        balance: asNum(i.balance),
        currencyCode: asStr(i.currency_code),
        status: asStr(i.status),
        payload: i as object,
      };
      const existing = await prisma.zohoImportedInvoice.findUnique({ where: { zohoId } });
      if (existing) {
        await prisma.zohoImportedInvoice.update({ where: { zohoId }, data });
        return "updated";
      }
      await prisma.zohoImportedInvoice.create({ data });
      return "created";
    },
  });

  // ── Customer payments ────────────────────────────────────────────────────
  const customerPayments = await importPaged({
    perPage,
    maxPages: opts.maxPages,
    fetcher: async (page, pp) => {
      const r = await listCustomerPayments({ page, per_page: pp });
      return { items: r.customerpayments, hasMore: !!r.page_context.has_more_page };
    },
    upsert: async (p) => {
      const zohoId = String(p.payment_id);
      const data = {
        zohoId,
        paymentSide: "CUSTOMER",
        zohoContactId: asStr(p.customer_id),
        contactName: asStr(p.customer_name),
        paymentDate: asDate(p.date),
        amount: asNum(p.amount),
        paymentMode: asStr(p.payment_mode),
        reference: asStr(p.reference_number),
        payload: p as object,
      };
      const existing = await prisma.zohoImportedPayment.findUnique({ where: { zohoId } });
      if (existing) {
        await prisma.zohoImportedPayment.update({ where: { zohoId }, data });
        return "updated";
      }
      await prisma.zohoImportedPayment.create({ data });
      return "created";
    },
  });

  // ── Vendor payments ──────────────────────────────────────────────────────
  const vendorPayments = await importPaged({
    perPage,
    maxPages: opts.maxPages,
    fetcher: async (page, pp) => {
      const r = await listVendorPayments({ page, per_page: pp });
      return { items: r.vendorpayments, hasMore: !!r.page_context.has_more_page };
    },
    upsert: async (p) => {
      const zohoId = String(p.payment_id);
      const data = {
        zohoId,
        paymentSide: "VENDOR",
        zohoContactId: asStr(p.vendor_id),
        contactName: asStr(p.vendor_name),
        paymentDate: asDate(p.date),
        amount: asNum(p.amount),
        paymentMode: asStr(p.payment_mode),
        reference: asStr(p.reference_number),
        payload: p as object,
      };
      const existing = await prisma.zohoImportedPayment.findUnique({ where: { zohoId } });
      if (existing) {
        await prisma.zohoImportedPayment.update({ where: { zohoId }, data });
        return "updated";
      }
      await prisma.zohoImportedPayment.create({ data });
      return "created";
    },
  });

  // ── Contacts ─────────────────────────────────────────────────────────────
  const contacts = await importPaged({
    perPage,
    maxPages: opts.maxPages,
    fetcher: async (page, pp) => {
      const r = await listContacts({ page, per_page: pp });
      return { items: r.contacts, hasMore: !!r.page_context.has_more_page };
    },
    upsert: async (c) => {
      const zohoId = String(c.contact_id);
      const data = {
        zohoId,
        contactName: asStr(c.contact_name),
        companyName: asStr(c.company_name),
        contactType: asStr(c.contact_type), // "customer", "vendor"
        email: asStr(c.email),
        phone: asStr(c.phone) ?? asStr(c.mobile),
        vatNumber: asStr(c.vat_reg_no) ?? asStr(c.vat_number),
        payload: c as object,
      };
      const existing = await prisma.zohoImportedContact.findUnique({ where: { zohoId } });
      if (existing) {
        await prisma.zohoImportedContact.update({ where: { zohoId }, data });
        return "updated";
      }
      await prisma.zohoImportedContact.create({ data });
      return "created";
    },
  });

  const finishedAt = new Date();
  return {
    bills,
    invoices,
    customerPayments,
    vendorPayments,
    contacts,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}
