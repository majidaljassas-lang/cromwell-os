/**
 * Central GL posting module — F2 of the finance build.
 *
 * Every commercial event in the OS posts a balanced JournalEntry through
 * one of the `post*` functions here. All postings are:
 *
 *   1. **Idempotent.** Keyed on (sourceType, sourceId). Re-running never
 *      creates a duplicate JE.
 *   2. **Line-decomposed.** SalesInvoice / SupplierBill produce ONE JournalLine
 *      per source line item (carrying ticketLineId), so every penny ties
 *      back to the exact item — both globally (sum by accountId) and at
 *      line-item level (filter by ticketLineId / customerId / siteId).
 *   3. **Balanced.** Total debit = total credit, always. Validated before insert.
 *   4. **Account-balance updating.** ChartOfAccount.currentBalance moved on POST.
 *
 * Public surface:
 *   - postSupplierBill(billId, tx?)         → AP entry
 *   - postSalesInvoice(invoiceId, tx?)      → AR entry
 *   - postPaymentReceived(paymentId, tx?)   → settle AR against bank
 *   - postPaymentMade(paymentMadeId, tx?)   → settle AP against bank
 *   - postCashSale(cashSaleId, tx?)         → direct bank receipt + sales
 *   - postSalesCreditNote(creditNoteId, tx?)→ reverse-of-sale
 *   - postBankSettlement(opts, tx?)         → catch-all for bank-reconciler matches
 */

import { prisma as defaultPrisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@/generated/prisma";

type Tx = Prisma.TransactionClient | PrismaClient;

interface JournalLineInput {
  accountId: string;
  description?: string | null;
  debit?: number;
  credit?: number;
  customerId?: string | null;
  siteId?: string | null;
  ticketId?: string | null;
  ticketLineId?: string | null;
  supplierId?: string | null;
}

interface PostJournalArgs {
  entryDate: Date;
  reference?: string | null;
  description: string;
  sourceType: string;
  sourceId: string;
  lines: JournalLineInput[];
}

/** Round to 2dp for currency safety. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Resolve (or auto-create) the FiscalPeriod that contains `date`.
 * Periods are monthly, label "YYYY-MM". Throws if the matched period is LOCKED.
 */
async function getOrCreatePeriodFor(
  tx: Tx,
  date: Date,
  context: string
): Promise<{ id: string; status: string; label: string }> {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const label = `${y}-${String(m + 1).padStart(2, "0")}`;
  const startDate = new Date(Date.UTC(y, m, 1));
  const endDate = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));

  const existing = await tx.fiscalPeriod.findUnique({ where: { label } });
  if (existing) {
    if (existing.status === "LOCKED") {
      throw new Error(
        `[gl-posting] Period ${label} is LOCKED — cannot post ${context} dated ${date.toISOString().slice(0, 10)}`
      );
    }
    return existing;
  }
  const created = await tx.fiscalPeriod.create({
    data: { label, startDate, endDate, status: "OPEN" },
  });
  return created;
}

/**
 * Core posting primitive. All `post*` functions funnel through here.
 * Validates balance, checks idempotency, creates JE + lines, bumps balances.
 */
async function postJournal(
  tx: Tx,
  args: PostJournalArgs
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.journalEntry.findFirst({
    where: { sourceType: args.sourceType, sourceId: args.sourceId },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const totalDebit = r2(args.lines.reduce((s, l) => s + (l.debit ?? 0), 0));
  const totalCredit = r2(args.lines.reduce((s, l) => s + (l.credit ?? 0), 0));
  if (totalDebit !== totalCredit) {
    throw new Error(
      `[gl-posting] Unbalanced JE for ${args.sourceType} ${args.sourceId}: ` +
        `debit £${totalDebit.toFixed(2)} ≠ credit £${totalCredit.toFixed(2)}`
    );
  }
  if (totalDebit === 0) {
    throw new Error(
      `[gl-posting] Zero-value JE for ${args.sourceType} ${args.sourceId}`
    );
  }

  const period = await getOrCreatePeriodFor(
    tx,
    args.entryDate,
    `${args.sourceType} ${args.sourceId}`
  );

  const entry = await tx.journalEntry.create({
    data: {
      entryDate: args.entryDate,
      periodId: period.id,
      reference: args.reference ?? null,
      description: args.description,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      status: "POSTED",
      lines: {
        create: args.lines.map((l) => ({
          accountId: l.accountId,
          description: l.description ?? null,
          debit: r2(l.debit ?? 0),
          credit: r2(l.credit ?? 0),
          customerId: l.customerId ?? null,
          siteId: l.siteId ?? null,
          ticketId: l.ticketId ?? null,
          ticketLineId: l.ticketLineId ?? null,
          supplierId: l.supplierId ?? null,
        })),
      },
    },
  });

  // Bump account balances (DR positive, CR negative — sign flipped per account type
  // is a reporting concern, not a balance concern; we keep raw debit/credit deltas)
  const balanceUpdates = new Map<string, number>();
  for (const l of args.lines) {
    const delta = (l.debit ?? 0) - (l.credit ?? 0);
    balanceUpdates.set(l.accountId, (balanceUpdates.get(l.accountId) ?? 0) + delta);
  }
  for (const [accountId, delta] of balanceUpdates) {
    await tx.chartOfAccount.update({
      where: { id: accountId },
      data: { currentBalance: { increment: r2(delta) } },
    });
  }

  return { id: entry.id, created: true };
}

/**
 * Reverse and delete an existing JE keyed on (sourceType, sourceId).
 * Restores ChartOfAccount.currentBalance and removes JournalLines + entry.
 * No-op if no entry exists. Used when source data changes after posting.
 */
export async function reverseJournal(
  tx: Tx,
  sourceType: string,
  sourceId: string
): Promise<{ reversed: boolean }> {
  const entry = await tx.journalEntry.findFirst({
    where: { sourceType, sourceId },
    include: { lines: true },
  });
  if (!entry) return { reversed: false };

  // Roll back account balances (negate the original delta).
  const balanceUpdates = new Map<string, number>();
  for (const l of entry.lines) {
    const delta = Number(l.debit) - Number(l.credit);
    balanceUpdates.set(l.accountId, (balanceUpdates.get(l.accountId) ?? 0) - delta);
  }
  for (const [accountId, delta] of balanceUpdates) {
    await tx.chartOfAccount.update({
      where: { id: accountId },
      data: { currentBalance: { increment: r2(delta) } },
    });
  }

  await tx.journalLine.deleteMany({ where: { journalEntryId: entry.id } });
  await tx.journalEntry.delete({ where: { id: entry.id } });
  return { reversed: true };
}

/** Resolve standard CoA codes once per posting. */
async function loadAccounts(tx: Tx, codes: string[]) {
  const accounts = await tx.chartOfAccount.findMany({
    where: { accountCode: { in: codes } },
    select: { id: true, accountCode: true },
  });
  const map = new Map(accounts.map((a) => [a.accountCode, a.id]));
  for (const c of codes) {
    if (!map.has(c)) {
      throw new Error(`[gl-posting] Missing required CoA account: ${c}`);
    }
  }
  return map;
}

/** Pick the revenue account for a given sales line. Defaults to Materials. */
function revenueAccountForLine(
  ticketLine: { lineType?: string | null; description?: string } | null,
  accounts: Map<string, string>
): string {
  const lineType = ticketLine?.lineType?.toUpperCase() ?? "";
  if (lineType === "LABOUR") return accounts.get("4100")!;
  if (lineType === "HIRE") return accounts.get("4030")!;
  if (lineType === "DELIVERY" || lineType === "CARRIAGE")
    return accounts.get("4200")!;
  return accounts.get("4000")!; // Materials default
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Public posters                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * SupplierBill → AP entry, one COGS line per SupplierBillLine.
 * DR Materials/COGS (per line, with ticketLineId) · DR VAT Input · CR Trade Creditors
 */
export async function postSupplierBill(
  billId: string,
  txArg?: Tx
): Promise<{ id: string; created: boolean }> {
  const tx = txArg ?? defaultPrisma;
  const bill = await tx.supplierBill.findUnique({
    where: { id: billId },
    include: { lines: true, supplier: true },
  });
  if (!bill) throw new Error(`SupplierBill ${billId} not found`);

  const accounts = await loadAccounts(tx, ["5000", "1300", "2000"]);

  const linesArr: JournalLineInput[] = [];
  let netTotal = 0;
  let vatTotal = 0;

  if (bill.lines.length > 0) {
    for (const line of bill.lines) {
      const lineNet =
        line.amountExVat != null
          ? Number(line.amountExVat)
          : Number(line.lineTotal);
      const lineVat = line.vatAmount != null ? Number(line.vatAmount) : 0;
      netTotal += lineNet;
      vatTotal += lineVat;
      linesArr.push({
        accountId: accounts.get("5000")!,
        description: line.description ?? `Bill line — ${bill.billNo ?? bill.id}`,
        debit: lineNet,
        supplierId: bill.supplierId,
        customerId: line.customerId ?? null,
        siteId: line.siteId ?? null,
        ticketId: line.ticketId ?? null,
      });
    }
  } else {
    // Header-only bill; single COGS line
    netTotal = Number(bill.amountExVat ?? bill.totalCost ?? 0);
    vatTotal = Number(bill.vatAmount ?? 0);
    linesArr.push({
      accountId: accounts.get("5000")!,
      description: `Bill ${bill.billNo ?? bill.id}`,
      debit: netTotal,
      supplierId: bill.supplierId,
    });
  }

  if (vatTotal > 0) {
    linesArr.push({
      accountId: accounts.get("1300")!,
      description: `VAT input — bill ${bill.billNo ?? bill.id}`,
      debit: vatTotal,
      supplierId: bill.supplierId,
    });
  }

  const grossTotal = r2(netTotal + vatTotal);
  linesArr.push({
    accountId: accounts.get("2000")!,
    description: `Trade creditors — bill ${bill.billNo ?? bill.id}`,
    credit: grossTotal,
    supplierId: bill.supplierId,
  });

  return postJournal(tx, {
    entryDate: bill.billDate,
    reference: bill.billNo,
    description: `Supplier bill ${bill.billNo ?? bill.id} — AP entry`,
    sourceType: "SUPPLIER_BILL",
    sourceId: bill.id,
    lines: linesArr,
  });
}

/**
 * SalesInvoice → AR entry, one revenue line per SalesInvoiceLine.
 * DR Trade Debtors · CR Sales (per line, with ticketLineId) · CR VAT Output
 */
export async function postSalesInvoice(
  invoiceId: string,
  txArg?: Tx
): Promise<{ id: string; created: boolean }> {
  const tx = txArg ?? defaultPrisma;
  const inv = await tx.salesInvoice.findUnique({
    where: { id: invoiceId },
    include: { lines: { include: { ticketLine: true } } },
  });
  if (!inv) throw new Error(`SalesInvoice ${invoiceId} not found`);
  if (!inv.issuedAt) throw new Error(`Invoice ${invoiceId} has no issuedAt date`);

  const accounts = await loadAccounts(tx, [
    "1100", // Trade Debtors
    "2100", // VAT Output
    "4000", // Sales — Materials
    "4020", // Sales — Project
    "4030", // Hire Income
    "4100", // Sales — Labour
    "4200", // Carriage
  ]);

  const linesArr: JournalLineInput[] = [];
  let netTotal = 0;
  let vatTotal = 0;

  for (const line of inv.lines) {
    const lineNet = Number(line.lineTotal);
    const lineVat = line.vatAmount != null ? Number(line.vatAmount) : 0;
    netTotal += lineNet;
    vatTotal += lineVat;
    linesArr.push({
      accountId: revenueAccountForLine(line.ticketLine, accounts),
      description: line.description,
      credit: lineNet,
      customerId: inv.customerId,
      siteId: inv.siteId,
      ticketId: inv.ticketId,
      ticketLineId: line.ticketLineId,
    });
  }

  if (vatTotal > 0) {
    linesArr.push({
      accountId: accounts.get("2100")!,
      description: `VAT output — invoice ${inv.invoiceNo ?? inv.id}`,
      credit: vatTotal,
      customerId: inv.customerId,
      siteId: inv.siteId,
      ticketId: inv.ticketId,
    });
  }

  const grossTotal = r2(netTotal + vatTotal);
  linesArr.push({
    accountId: accounts.get("1100")!,
    description: `Trade debtors — invoice ${inv.invoiceNo ?? inv.id}`,
    debit: grossTotal,
    customerId: inv.customerId,
    siteId: inv.siteId,
    ticketId: inv.ticketId,
  });

  return postJournal(tx, {
    entryDate: inv.issuedAt,
    reference: inv.invoiceNo,
    description: `Sales invoice ${inv.invoiceNo ?? inv.id} — AR entry`,
    sourceType: "SALES_INVOICE",
    sourceId: inv.id,
    lines: linesArr,
  });
}

/**
 * Payment received (sales side) → DR Bank · CR Trade Debtors
 */
export async function postPaymentReceived(
  paymentId: string,
  bankAccountCode: string = "1000",
  txArg?: Tx
): Promise<{ id: string; created: boolean }> {
  const tx = txArg ?? defaultPrisma;
  const pay = await tx.payment.findUnique({
    where: { id: paymentId },
    include: { salesInvoice: true },
  });
  if (!pay) throw new Error(`Payment ${paymentId} not found`);

  const accounts = await loadAccounts(tx, [bankAccountCode, "1100"]);

  return postJournal(tx, {
    entryDate: pay.paymentDate,
    reference: pay.reference ?? null,
    description: `Payment received — invoice ${pay.salesInvoice.invoiceNo ?? pay.salesInvoiceId}`,
    sourceType: "PAYMENT_RECEIVED",
    sourceId: pay.id,
    lines: [
      {
        accountId: accounts.get(bankAccountCode)!,
        description: `Bank receipt — ${pay.reference ?? pay.id}`,
        debit: Number(pay.amount),
        customerId: pay.salesInvoice.customerId,
        ticketId: pay.salesInvoice.ticketId,
      },
      {
        accountId: accounts.get("1100")!,
        description: `Settle debtors — invoice ${pay.salesInvoice.invoiceNo ?? pay.salesInvoiceId}`,
        credit: Number(pay.amount),
        customerId: pay.salesInvoice.customerId,
        ticketId: pay.salesInvoice.ticketId,
      },
    ],
  });
}

/**
 * PaymentMade (supplier side) → DR Trade Creditors · CR Bank.
 * Sets PaymentMade.journalEntryId after posting.
 */
export async function postPaymentMade(
  paymentMadeId: string,
  bankAccountCode: string = "1000",
  txArg?: Tx
): Promise<{ id: string; created: boolean }> {
  const tx = txArg ?? defaultPrisma;
  const pm = await tx.paymentMade.findUnique({
    where: { id: paymentMadeId },
    include: { supplier: true, allocations: true },
  });
  if (!pm) throw new Error(`PaymentMade ${paymentMadeId} not found`);

  const accounts = await loadAccounts(tx, [bankAccountCode, "2000"]);

  const result = await postJournal(tx, {
    entryDate: pm.paymentDate,
    reference: pm.reference ?? null,
    description: `Payment to ${pm.supplier.name}${pm.reference ? ` — ${pm.reference}` : ""}`,
    sourceType: "PAYMENT_MADE",
    sourceId: pm.id,
    lines: [
      {
        accountId: accounts.get("2000")!,
        description: `Settle creditors — ${pm.supplier.name}`,
        debit: Number(pm.amount),
        supplierId: pm.supplierId,
      },
      {
        accountId: accounts.get(bankAccountCode)!,
        description: `Bank payment — ${pm.reference ?? pm.id}`,
        credit: Number(pm.amount),
        supplierId: pm.supplierId,
      },
    ],
  });

  if (result.created && !pm.journalEntryId) {
    await tx.paymentMade.update({
      where: { id: pm.id },
      data: { journalEntryId: result.id },
    });
  }
  return result;
}

/**
 * CashSale → DR Bank/Cash · CR Sales · CR VAT Output (if any)
 * Defaults to bank account 1000; pass "1500" for petty cash.
 */
export async function postCashSale(
  cashSaleId: string,
  bankAccountCode: string = "1000",
  txArg?: Tx
): Promise<{ id: string; created: boolean }> {
  const tx = txArg ?? defaultPrisma;
  const cs = await tx.cashSale.findUnique({
    where: { id: cashSaleId },
    include: { ticket: { include: { payingCustomer: true, site: true } } },
  });
  if (!cs) throw new Error(`CashSale ${cashSaleId} not found`);

  const accounts = await loadAccounts(tx, [bankAccountCode, "4000", "2100"]);

  // Cash sale is gross; assume 20% VAT inclusive unless future schema adds vat-rate field
  const gross = Number(cs.receivedAmount);
  const net = r2(gross / 1.2);
  const vat = r2(gross - net);

  const result = await postJournal(tx, {
    entryDate: cs.receivedAt,
    reference: cs.receiptRef ?? null,
    description: `Cash sale — ${cs.ticket.title}`,
    sourceType: "CASH_SALE",
    sourceId: cs.id,
    lines: [
      {
        accountId: accounts.get(bankAccountCode)!,
        description: `Cash receipt — ${cs.receiptRef ?? cs.id}`,
        debit: gross,
        customerId: cs.ticket.payingCustomerId,
        siteId: cs.ticket.siteId,
        ticketId: cs.ticketId,
      },
      {
        accountId: accounts.get("4000")!,
        description: `Cash sale — ${cs.ticket.title}`,
        credit: net,
        customerId: cs.ticket.payingCustomerId,
        siteId: cs.ticket.siteId,
        ticketId: cs.ticketId,
      },
      {
        accountId: accounts.get("2100")!,
        description: `VAT output — cash sale ${cs.id}`,
        credit: vat,
        customerId: cs.ticket.payingCustomerId,
        siteId: cs.ticket.siteId,
        ticketId: cs.ticketId,
      },
    ],
  });

  if (result.created && !cs.journalEntryId) {
    await tx.cashSale.update({
      where: { id: cs.id },
      data: { journalEntryId: result.id },
    });
  }
  return result;
}

/**
 * SalesCreditNote → reverse of sale.
 * DR Sales (rev) · DR VAT Output · CR Trade Debtors
 */
export async function postSalesCreditNote(
  creditNoteId: string,
  txArg?: Tx
): Promise<{ id: string; created: boolean }> {
  const tx = txArg ?? defaultPrisma;
  const cn = await tx.salesCreditNote.findUnique({
    where: { id: creditNoteId },
    include: { lines: true, customer: true, salesInvoice: true },
  });
  if (!cn) throw new Error(`SalesCreditNote ${creditNoteId} not found`);

  const accounts = await loadAccounts(tx, ["1100", "2100", "4000"]);

  const subtotal = Number(cn.subtotal);
  const vat = Number(cn.vatAmount);
  const total = Number(cn.total);

  const result = await postJournal(tx, {
    entryDate: cn.issueDate,
    reference: cn.creditNoteNo ?? null,
    description: `Credit note ${cn.creditNoteNo ?? cn.id} — reverse of sale`,
    sourceType: "SALES_CREDIT_NOTE",
    sourceId: cn.id,
    lines: [
      {
        accountId: accounts.get("4000")!,
        description: `Reverse sale — credit note ${cn.creditNoteNo ?? cn.id}`,
        debit: subtotal,
        customerId: cn.customerId,
      },
      ...(vat > 0
        ? [
            {
              accountId: accounts.get("2100")!,
              description: `Reverse VAT — credit note ${cn.creditNoteNo ?? cn.id}`,
              debit: vat,
              customerId: cn.customerId,
            } as JournalLineInput,
          ]
        : []),
      {
        accountId: accounts.get("1100")!,
        description: `Reverse debtors — credit note ${cn.creditNoteNo ?? cn.id}`,
        credit: total,
        customerId: cn.customerId,
      },
    ],
  });

  if (result.created && !cn.journalEntryId) {
    await tx.salesCreditNote.update({
      where: { id: cn.id },
      data: { journalEntryId: result.id },
    });
  }
  return result;
}

/**
 * Direct categorization of a bank transaction — used by the Bank Inbox UI
 * when no operational record exists (bank charges, owner drawings, transfers,
 * miscellaneous expenses). Posts a balanced JE between the bank account and
 * a chosen counterparty account, then sets BankTransaction.matchedJournalId.
 */
export async function postBankSettlement(
  args: {
    bankTransactionId: string;
    counterpartyAccountId: string;
    description: string;
    customerId?: string | null;
    siteId?: string | null;
    supplierId?: string | null;
    ticketId?: string | null;
  },
  txArg?: Tx
): Promise<{ id: string; created: boolean }> {
  const tx = txArg ?? defaultPrisma;
  const bt = await tx.bankTransaction.findUnique({
    where: { id: args.bankTransactionId },
    include: { bankAccount: true },
  });
  if (!bt) throw new Error(`BankTransaction ${args.bankTransactionId} not found`);
  if (!bt.bankAccount.accountId)
    throw new Error(`BankAccount ${bt.bankAccountId} has no linked CoA account`);

  const amount = Number(bt.amount);
  const isInflow = amount > 0;
  const abs = Math.abs(amount);

  const result = await postJournal(tx, {
    entryDate: bt.transactionDate,
    reference: bt.reference ?? null,
    description: args.description,
    sourceType: "BANK_TRANSACTION",
    sourceId: bt.id,
    lines: isInflow
      ? [
          {
            accountId: bt.bankAccount.accountId,
            description: `Bank receipt — ${bt.description}`,
            debit: abs,
            customerId: args.customerId ?? null,
            siteId: args.siteId ?? null,
            supplierId: args.supplierId ?? null,
            ticketId: args.ticketId ?? null,
          },
          {
            accountId: args.counterpartyAccountId,
            description: args.description,
            credit: abs,
            customerId: args.customerId ?? null,
            siteId: args.siteId ?? null,
            supplierId: args.supplierId ?? null,
            ticketId: args.ticketId ?? null,
          },
        ]
      : [
          {
            accountId: args.counterpartyAccountId,
            description: args.description,
            debit: abs,
            customerId: args.customerId ?? null,
            siteId: args.siteId ?? null,
            supplierId: args.supplierId ?? null,
            ticketId: args.ticketId ?? null,
          },
          {
            accountId: bt.bankAccount.accountId,
            description: `Bank payment — ${bt.description}`,
            credit: abs,
            customerId: args.customerId ?? null,
            siteId: args.siteId ?? null,
            supplierId: args.supplierId ?? null,
            ticketId: args.ticketId ?? null,
          },
        ],
  });

  if (result.created) {
    await tx.bankTransaction.update({
      where: { id: bt.id },
      data: {
        matchedJournalId: result.id,
        reconciliationStatus: "RECONCILED",
      },
    });
  }
  return result;
}
