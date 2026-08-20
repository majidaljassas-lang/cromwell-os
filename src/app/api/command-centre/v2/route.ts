import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Period = "Y" | "M" | "W" | "D";

function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfYear(d: Date): Date { return new Date(d.getFullYear(), 0, 1); }
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
function startOfDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function addYears(d: Date, n: number): Date { return new Date(d.getFullYear() + n, 0, 1); }
function addWeeks(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n * 7); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function bucketStart(d: Date, p: Period): Date {
  switch (p) {
    case "Y": return startOfYear(d);
    case "M": return startOfMonth(d);
    case "W": return startOfWeek(d);
    case "D": return startOfDay(d);
  }
}
function addBucket(d: Date, p: Period, n: number): Date {
  switch (p) {
    case "Y": return addYears(d, n);
    case "M": return addMonths(d, n);
    case "W": return addWeeks(d, n);
    case "D": return addDays(d, n);
  }
}
function bucketKey(d: Date, p: Period): string {
  switch (p) {
    case "Y": return String(d.getFullYear());
    case "M": return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    case "W": {
      const w = startOfWeek(d);
      const diffDays = (w.getTime() - new Date(w.getFullYear(), 0, 1).getTime()) / 86400000;
      const wk = Math.ceil((diffDays + 1) / 7);
      return `${w.getFullYear()}-W${String(wk).padStart(2, "0")}`;
    }
    case "D": return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
}
function bucketLabel(d: Date, p: Period): string {
  switch (p) {
    case "Y": return String(d.getFullYear());
    case "M": return d.toLocaleString("en-GB", { month: "short" }) + " " + String(d.getFullYear()).slice(2);
    case "W":
    case "D": return d.toLocaleString("en-GB", { day: "2-digit", month: "short" });
  }
}

const PERIOD_WINDOWS: Record<Period, { past: number; future: number }> = {
  Y: { past: 4, future: 1 },
  M: { past: 11, future: 6 },
  W: { past: 11, future: 8 },
  D: { past: 29, future: 14 },
};

type Contributor = { id: string; name: string; amount: number };
type Bucket = {
  key: string;
  label: string;
  isPast: boolean;
  cashIn: number;
  cashOut: number;
  pnlIncome: number;
  pnlCogs: number;
  pnlExpenses: number;
  insights: {
    topIncome: Contributor[];
    topCogs: Contributor[];
    topExpenses: Contributor[];
  };
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const periodParam = (url.searchParams.get("period") ?? "M").toUpperCase();
  const period: Period = (["Y", "M", "W", "D"].includes(periodParam) ? periodParam : "M") as Period;
  const win = PERIOD_WINDOWS[period];

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d30 = new Date(today); d30.setDate(d30.getDate() - 30);
  const d60 = new Date(today); d60.setDate(d60.getDate() - 60);
  const flowStart = addBucket(bucketStart(today, period), period, -win.past);
  const flowEnd = addBucket(bucketStart(today, period), period, win.future + 1);

  const [
    inboxNew,
    inboxEmail,
    inboxWa,
    inboxTriaged,
    inboxOverdue,
    ticketsByStatus,
    ticketsByMode,
    recentTickets,
    tasksByType,
    receivablesAll,
    payablesAll,
    disputed,
    stockItems,
    lastSync,
    eventsToday,
    urgentAlerts,
    arOpen,
    apOpen,
    paymentsIn,
    paymentsOut,
    invoicesPastIssued,
    invoicesUnpaidForExpected,
    invoicesDraft,
    billAllocationsPast,
    billAllocationsFuture,
    topCustomers,
    topSuppliers,
    overdueInvoices,
    unmatchedBills,
    schedulerLogs,
  ] = await Promise.all([
    prisma.inboxThread.count({ where: { status: "NEW" } }),
    prisma.inboxThread.count({ where: { status: "NEW", channel: "EMAIL" } }),
    prisma.inboxThread.count({ where: { status: "NEW", channel: { in: ["WHATSAPP", "WHATSAPP_GROUP"] } } }),
    prisma.inboxThread.count({ where: { status: "TRIAGED" } }),
    prisma.inboxThread.count({ where: { status: "TRIAGED", triageDueAt: { lt: now } } }),
    prisma.ticket.groupBy({ by: ["status"], _count: true, where: { status: { notIn: ["CLOSED"] } } }),
    prisma.ticket.groupBy({ by: ["ticketMode"], _count: true, where: { status: { notIn: ["CLOSED"] } } }),
    prisma.ticket.findMany({
      where: { status: { notIn: ["CLOSED"] } },
      select: {
        id: true, ticketNo: true, title: true, status: true, ticketMode: true, createdAt: true,
        payingCustomer: { select: { name: true } },
        site: { select: { siteName: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.task.groupBy({ by: ["taskType"], _count: true, where: { status: "OPEN" } }),
    prisma.salesInvoice.aggregate({ _sum: { totalSell: true }, _count: true, where: { status: { in: ["SENT", "UNPAID"] } } }),
    prisma.supplierBill.aggregate({ _sum: { totalCost: true }, _count: true, where: { paymentStatus: "UNPAID" } }),
    prisma.supplierBill.aggregate({ _sum: { totalCost: true }, _count: true, where: { matchStatus: "DISPUTE" } }),
    prisma.stockItem.aggregate({ _count: true, _sum: { qtyOnHand: true }, where: { isActive: true, outcome: "HOLDING" } }),
    prisma.ingestionSource.findFirst({ where: { sourceType: "OUTLOOK", isActive: true }, select: { lastSyncAt: true } }),
    prisma.ingestionEvent.count({ where: { receivedAt: { gte: today } } }),
    prisma.task.findMany({
      where: { status: "OPEN", priority: "HIGH" },
      select: { taskType: true, generatedReason: true, ticketId: true, ticket: { select: { ticketNo: true, title: true } } },
      orderBy: { createdAt: "asc" },
      take: 10,
    }),
    prisma.salesInvoice.findMany({
      where: { status: { in: ["SENT", "UNPAID"] } },
      select: { id: true, totalSell: true, dueDate: true, issuedAt: true, customerId: true, customer: { select: { name: true } } },
    }),
    prisma.supplierBill.findMany({
      where: { paymentStatus: "UNPAID" },
      select: { id: true, totalCost: true, dueDate: true, billDate: true, supplierId: true, supplier: { select: { name: true } } },
    }),
    // Cash IN — actual customer payments received (past buckets only)
    prisma.payment.findMany({
      where: { paymentDate: { gte: flowStart, lt: today } },
      select: {
        amount: true,
        paymentDate: true,
        salesInvoice: { select: { customerId: true, customer: { select: { name: true } } } },
      },
    }),
    // Cash OUT — actual supplier payments made (past buckets only)
    prisma.paymentMade.findMany({
      where: { paymentDate: { gte: flowStart, lt: today } },
      select: { amount: true, paymentDate: true, supplierId: true, supplier: { select: { name: true } } },
    }),
    // Income recognised — paid invoices by paid date (past, included in cashIn already; not used directly)
    prisma.salesInvoice.findMany({
      where: { issuedAt: { gte: flowStart, lt: today }, status: "PAID" },
      select: { totalSell: true, issuedAt: true, customerId: true, customer: { select: { name: true } } },
    }),
    // Expected income — unpaid invoices projected to dueDate (or issuedAt fallback)
    prisma.salesInvoice.findMany({
      where: { status: { in: ["SENT", "UNPAID"] } },
      select: { totalSell: true, dueDate: true, issuedAt: true, customerId: true, customer: { select: { name: true } } },
    }),
    // Drafts — projected to issuedAt (or today if null)
    prisma.salesInvoice.findMany({
      where: { status: "DRAFT" },
      select: { totalSell: true, dueDate: true, issuedAt: true, customerId: true, customer: { select: { name: true } } },
    }),
    // Bill allocations — past, by billDate (actual COGS / Expense recognition)
    prisma.billLineAllocation.findMany({
      where: {
        allocationType: { in: ["TICKET_LINE", "STOCK", "RETURNS_CANDIDATE", "OVERHEAD"] },
        supplierBillLine: { supplierBill: { billDate: { gte: flowStart, lt: today } } },
      },
      select: {
        allocationType: true,
        costAllocated: true,
        supplierBillLine: {
          select: {
            supplierBill: {
              select: { billDate: true, dueDate: true, supplierId: true, supplier: { select: { name: true } } },
            },
          },
        },
      },
    }),
    // Bill allocations — future, by dueDate (expected from unpaid bills)
    prisma.billLineAllocation.findMany({
      where: {
        allocationType: { in: ["TICKET_LINE", "STOCK", "RETURNS_CANDIDATE", "OVERHEAD"] },
        supplierBillLine: {
          supplierBill: {
            paymentStatus: "UNPAID",
            dueDate: { gte: today, lt: flowEnd },
          },
        },
      },
      select: {
        allocationType: true,
        costAllocated: true,
        supplierBillLine: {
          select: {
            supplierBill: {
              select: { billDate: true, dueDate: true, supplierId: true, supplier: { select: { name: true } } },
            },
          },
        },
      },
    }),
    prisma.salesInvoice.groupBy({
      by: ["customerId"],
      where: { status: { in: ["SENT", "UNPAID"] } },
      _sum: { totalSell: true },
      _count: true,
      orderBy: { _sum: { totalSell: "desc" } },
      take: 5,
    }),
    prisma.supplierBill.groupBy({
      by: ["supplierId"],
      where: { paymentStatus: "UNPAID" },
      _sum: { totalCost: true },
      _count: true,
      orderBy: { _sum: { totalCost: "desc" } },
      take: 5,
    }),
    prisma.salesInvoice.aggregate({
      _sum: { totalSell: true }, _count: true,
      where: { status: { in: ["SENT", "UNPAID"] }, dueDate: { lt: today } },
    }),
    prisma.supplierBill.count({ where: { OR: [{ matchStatus: "VARIANCE" }, { matchStatus: "AWAITING_DELIVERY" }, { matchStatus: null }] } }),
    prisma.schedulerLog.findMany({
      where: { status: "OK" },
      orderBy: { startedAt: "desc" },
      take: 8,
      select: { job: true, startedAt: true, summary: true },
    }),
  ]);

  // ── Balance sheet ───────────────────────────────────────────────────────
  const [bankAccounts, unpaidInvoiceTotals, unpaidBillTotals, draftInvoiceTotals, otherDebtorsAcct] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { isActive: true },
      select: {
        bankName: true, accountName: true, currentBalance: true,
        account: { select: { accountCode: true, accountName: true, accountType: true, accountSubType: true } },
      },
    }),
    prisma.salesInvoice.aggregate({
      where: { status: { in: ["SENT", "UNPAID"] } },
      _sum: { totalGross: true, totalNet: true, totalSell: true },
      _count: true,
    }),
    prisma.supplierBill.aggregate({
      where: { paymentStatus: "UNPAID" },
      _sum: { amountIncVat: true, amountExVat: true, totalCost: true },
      _count: true,
    }),
    prisma.salesInvoice.aggregate({
      where: { status: "DRAFT" },
      _sum: { totalGross: true, totalNet: true, totalSell: true },
      _count: true,
    }),
    prisma.chartOfAccount.findFirst({
      where: { accountCode: "1200" },
      select: { id: true, accountName: true, accountCode: true },
    }),
  ]);

  type Line = { code: string; name: string; amount: number };
  const cashLines: Line[] = [];
  const liabilityBankLines: Line[] = [];
  for (const b of bankAccounts) {
    const bal = Number(b.currentBalance);
    const label = `${b.bankName} · ${b.accountName}`;
    if (b.account?.accountType === "ASSET") {
      cashLines.push({ code: b.account.accountCode, name: label, amount: bal });
    } else if (b.account?.accountType === "LIABILITY") {
      liabilityBankLines.push({ code: b.account.accountCode, name: label, amount: Math.abs(bal) });
    }
  }
  cashLines.sort((a, b) => a.code.localeCompare(b.code));
  liabilityBankLines.sort((a, b) => a.code.localeCompare(b.code));

  const totalCash = cashLines.reduce((s, l) => s + l.amount, 0);
  const arGross = Number(unpaidInvoiceTotals._sum.totalGross ?? 0) || Number(unpaidInvoiceTotals._sum.totalSell ?? 0);
  const arNet = Number(unpaidInvoiceTotals._sum.totalNet ?? 0) || (arGross / 1.2);
  const arCount = unpaidInvoiceTotals._count;
  const apGross = Number(unpaidBillTotals._sum.amountIncVat ?? 0) || Number(unpaidBillTotals._sum.totalCost ?? 0);
  const apNet = Number(unpaidBillTotals._sum.amountExVat ?? 0) || (apGross / 1.2);
  const apCount = unpaidBillTotals._count;
  const draftsGross = Number(draftInvoiceTotals._sum.totalGross ?? 0) || Number(draftInvoiceTotals._sum.totalSell ?? 0);
  const draftsNet = Number(draftInvoiceTotals._sum.totalNet ?? 0) || (draftsGross / 1.2);
  const draftsCount = draftInvoiceTotals._count;

  const otherDebtorsLines: Line[] = [];
  let otherDebtorsTotal = 0;
  if (otherDebtorsAcct) {
    const bal = await prisma.journalLine.aggregate({
      where: { accountId: otherDebtorsAcct.id, journalEntry: { status: "POSTED" } },
      _sum: { debit: true, credit: true },
    });
    const amt = Number(bal._sum.debit ?? 0) - Number(bal._sum.credit ?? 0);
    if (Math.abs(amt) > 0.01) {
      otherDebtorsLines.push({ code: otherDebtorsAcct.accountCode, name: otherDebtorsAcct.accountName, amount: amt });
      otherDebtorsTotal = amt;
    }
  }

  const totalCurrentAssets = totalCash + arGross + otherDebtorsTotal;
  const totalLiabilityBanks = liabilityBankLines.reduce((s, l) => s + l.amount, 0);
  const totalCurrentLiabilities = apGross + totalLiabilityBanks;
  const netCurrentAssets = totalCurrentAssets - totalCurrentLiabilities;
  const netPositionInclDrafts = netCurrentAssets + draftsGross;

  const balanceSheet = {
    cash: { lines: cashLines, total: totalCash },
    ar: { gross: arGross, net: arNet, count: arCount },
    otherDebtors: { lines: otherDebtorsLines, total: otherDebtorsTotal },
    otherCurrentAssets: { lines: [] as Line[], total: 0 },
    totalCurrentAssets,
    ap: { gross: apGross, net: apNet, count: apCount },
    otherCurrentLiabilities: { lines: liabilityBankLines, total: totalLiabilityBanks },
    totalCurrentLiabilities,
    netCurrentAssets,
    draftInvoices: { gross: draftsGross, net: draftsNet, count: draftsCount },
    netPositionInclDrafts,
  };

  const statusMap: Record<string, number> = {};
  for (const s of ticketsByStatus) statusMap[s.status] = s._count;
  const modeMap: Record<string, number> = {};
  for (const m of ticketsByMode) modeMap[m.ticketMode] = m._count;
  const taskMap: Record<string, number> = {};
  let taskTotal = 0;
  for (const t of tasksByType) { taskMap[t.taskType] = t._count; taskTotal += t._count; }

  // AR / AP aging buckets
  const arBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_plus: 0 };
  for (const inv of arOpen) {
    const amt = Number(inv.totalSell ?? 0);
    const due = inv.dueDate ?? inv.issuedAt;
    if (!due || due >= today) arBuckets.current += amt;
    else if (due >= d30) arBuckets.d1_30 += amt;
    else if (due >= d60) arBuckets.d31_60 += amt;
    else arBuckets.d61_plus += amt;
  }
  const apBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_plus: 0 };
  for (const bill of apOpen) {
    const amt = Number(bill.totalCost ?? 0);
    const due = bill.dueDate ?? bill.billDate;
    if (!due || due >= today) apBuckets.current += amt;
    else if (due >= d30) apBuckets.d1_30 += amt;
    else if (due >= d60) apBuckets.d31_60 += amt;
    else apBuckets.d61_plus += amt;
  }

  // ── Cash flow / P&L bucket assembly ──────────────────────────────────────
  const totalBuckets = win.past + win.future + 1;
  const buckets: Bucket[] = [];
  const keyToIdx = new Map<string, number>();
  for (let i = 0; i < totalBuckets; i++) {
    const start = addBucket(bucketStart(today, period), period, i - win.past);
    const k = bucketKey(start, period);
    const isPast = start < bucketStart(today, period);
    buckets.push({
      key: k,
      label: bucketLabel(start, period),
      isPast,
      cashIn: 0,
      cashOut: 0,
      pnlIncome: 0,
      pnlCogs: 0,
      pnlExpenses: 0,
      insights: { topIncome: [], topCogs: [], topExpenses: [] },
    });
    keyToIdx.set(k, i);
  }

  // Per-bucket contributor accumulators
  const incomeAcc: Map<number, Map<string, Contributor>> = new Map();
  const cogsAcc: Map<number, Map<string, Contributor>> = new Map();
  const expenseAcc: Map<number, Map<string, Contributor>> = new Map();
  function addContributor(acc: Map<number, Map<string, Contributor>>, idx: number, c: Contributor) {
    if (!acc.has(idx)) acc.set(idx, new Map());
    const m = acc.get(idx)!;
    const existing = m.get(c.id);
    if (existing) existing.amount += c.amount;
    else m.set(c.id, { ...c });
  }

  function findIdx(d: Date | null | undefined): number {
    if (!d) return -1;
    const k = bucketKey(d, period);
    return keyToIdx.get(k) ?? -1;
  }

  // Past actual cash in
  for (const p of paymentsIn) {
    const i = findIdx(p.paymentDate);
    if (i >= 0) {
      const amt = Number(p.amount);
      buckets[i].cashIn += amt;
      buckets[i].pnlIncome += amt; // past P&L income = cash received
      const cid = p.salesInvoice?.customerId;
      const cname = p.salesInvoice?.customer?.name;
      if (cid) addContributor(incomeAcc, i, { id: cid, name: cname ?? "(unknown)", amount: amt });
    }
  }
  // Past actual cash out — splits into COGS vs Expenses driven by allocations below.
  for (const p of paymentsOut) {
    const i = findIdx(p.paymentDate);
    if (i >= 0) buckets[i].cashOut += Number(p.amount);
  }

  // Past COGS / Expenses — by billDate, split by allocationType
  for (const a of billAllocationsPast) {
    const billDate = a.supplierBillLine?.supplierBill?.billDate;
    const i = findIdx(billDate);
    if (i < 0) continue;
    const amt = Number(a.costAllocated);
    const supId = a.supplierBillLine?.supplierBill?.supplierId ?? "_";
    const supName = a.supplierBillLine?.supplierBill?.supplier?.name ?? "(unknown)";
    if (a.allocationType === "OVERHEAD") {
      buckets[i].pnlExpenses += amt;
      addContributor(expenseAcc, i, { id: supId, name: supName, amount: amt });
    } else {
      buckets[i].pnlCogs += amt;
      addContributor(cogsAcc, i, { id: supId, name: supName, amount: amt });
    }
  }

  // Future expected income — unpaid invoices projected to dueDate (fallback issuedAt, then today)
  for (const inv of invoicesUnpaidForExpected) {
    const projDate = inv.dueDate ?? inv.issuedAt ?? today;
    const i = findIdx(projDate);
    if (i < 0 || buckets[i].isPast) continue; // only future
    const amt = Number(inv.totalSell ?? 0);
    buckets[i].pnlIncome += amt;
    if (inv.customerId) addContributor(incomeAcc, i, { id: inv.customerId, name: inv.customer?.name ?? "(unknown)", amount: amt });
  }
  // Drafts — projected to issuedAt or today
  for (const inv of invoicesDraft) {
    const projDate = inv.dueDate ?? inv.issuedAt ?? today;
    const i = findIdx(projDate);
    if (i < 0 || buckets[i].isPast) continue;
    const amt = Number(inv.totalSell ?? 0);
    buckets[i].pnlIncome += amt;
    if (inv.customerId) addContributor(incomeAcc, i, { id: inv.customerId, name: (inv.customer?.name ?? "(draft)") + " · DRAFT", amount: amt });
  }

  // Future expected COGS / Expenses — unpaid bill allocations by dueDate
  for (const a of billAllocationsFuture) {
    const dueDate = a.supplierBillLine?.supplierBill?.dueDate;
    const i = findIdx(dueDate);
    if (i < 0 || buckets[i].isPast) continue;
    const amt = Number(a.costAllocated);
    const supId = a.supplierBillLine?.supplierBill?.supplierId ?? "_";
    const supName = a.supplierBillLine?.supplierBill?.supplier?.name ?? "(unknown)";
    if (a.allocationType === "OVERHEAD") {
      buckets[i].pnlExpenses += amt;
      addContributor(expenseAcc, i, { id: supId, name: supName, amount: amt });
    } else {
      buckets[i].pnlCogs += amt;
      addContributor(cogsAcc, i, { id: supId, name: supName, amount: amt });
    }
  }

  // Reduce contributor maps to top 3 per bucket
  for (let i = 0; i < buckets.length; i++) {
    const top = (m: Map<string, Contributor> | undefined): Contributor[] =>
      m ? Array.from(m.values()).sort((a, b) => b.amount - a.amount).slice(0, 3) : [];
    buckets[i].insights.topIncome = top(incomeAcc.get(i));
    buckets[i].insights.topCogs = top(cogsAcc.get(i));
    buckets[i].insights.topExpenses = top(expenseAcc.get(i));
  }

  const todayKey = bucketKey(today, period);

  // Top customer/supplier names
  const customerIds = topCustomers.map((c) => c.customerId);
  const supplierIds = topSuppliers.map((s) => s.supplierId);
  const [custNames, supNames] = await Promise.all([
    customerIds.length ? prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    supplierIds.length ? prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const custMap = new Map(custNames.map((c) => [c.id, c.name]));
  const supMap = new Map(supNames.map((s) => [s.id, s.name]));

  // Suppress unused-variable warning — kept for future P&L-on-issue mode if needed.
  void invoicesPastIssued;

  return Response.json({
    inbox: {
      newCount: inboxNew, emailCount: inboxEmail, whatsappCount: inboxWa,
      triagedCount: inboxTriaged, overdueCount: inboxOverdue,
    },
    tickets: {
      total: Object.values(statusMap).reduce((a, b) => a + b, 0),
      byStatus: statusMap, byMode: modeMap,
      recent: recentTickets.map((t) => ({
        id: t.id, ticketNo: t.ticketNo, title: t.title, status: t.status, mode: t.ticketMode,
        customer: t.payingCustomer?.name ?? "", site: t.site?.siteName ?? "",
        lines: t._count.lines, createdAt: t.createdAt,
      })),
    },
    financial: {
      receivables: Number(receivablesAll._sum.totalSell ?? 0),
      receivablesCount: receivablesAll._count,
      payables: Number(payablesAll._sum.totalCost ?? 0),
      payablesCount: payablesAll._count,
      disputed: Number(disputed._sum.totalCost ?? 0),
      disputedCount: disputed._count,
      arAging: arBuckets,
      apAging: apBuckets,
      cashFlow: { period, todayKey, buckets },
      topCustomers: topCustomers.map((c) => ({
        id: c.customerId,
        name: custMap.get(c.customerId) ?? "(unknown)",
        amount: Number(c._sum.totalSell ?? 0),
        count: c._count,
      })),
      topSuppliers: topSuppliers.map((s) => ({
        id: s.supplierId,
        name: supMap.get(s.supplierId) ?? "(unknown)",
        amount: Number(s._sum.totalCost ?? 0),
        count: s._count,
      })),
      stuck: {
        overdueAr: Number(overdueInvoices._sum.totalSell ?? 0),
        overdueArCount: overdueInvoices._count,
        unmatchedBills: unmatchedBills,
        disputedAp: Number(disputed._sum.totalCost ?? 0),
        disputedApCount: disputed._count,
      },
      balanceSheet,
    },
    tasks: { total: taskTotal, byType: taskMap },
    stock: { itemCount: stockItems._count, totalValue: Number(stockItems._sum.qtyOnHand ?? 0) },
    activity: schedulerLogs.map((l) => ({
      job: l.job,
      startedAt: l.startedAt.toISOString(),
      summary: l.summary as Record<string, unknown> | null,
    })),
    urgentAlerts: urgentAlerts.map((a) => ({
      taskType: a.taskType, reason: a.generatedReason,
      ticketNo: a.ticket?.ticketNo, ticketTitle: a.ticket?.title, ticketId: a.ticketId,
    })),
    system: {
      lastSync: lastSync?.lastSyncAt?.toISOString() ?? null,
      eventsToday,
    },
  });
}
