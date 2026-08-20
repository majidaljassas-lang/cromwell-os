import { prisma } from "@/lib/prisma";
import { CustomerDetail } from "@/components/customers/customer-detail";
import { DebtAccountPanel } from "@/components/customers/debt-account-panel";
import { getEffectiveBillingDetails } from "@/lib/customers/effective-billing";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      siteCommercialLinks: {
        include: { site: { select: { id: true, siteName: true, siteCode: true, city: true, postcode: true, aliases: true } } },
        where: { isActive: true },
      },
      siteContactLinks: {
        include: { contact: { select: { id: true, fullName: true, phone: true, email: true } } },
        where: { isActive: true },
      },
      customerPOs: {
        select: { id: true, poNo: true, poType: true, status: true, totalValue: true, customerId: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      parentEntity: { select: { id: true, name: true, isBillingEntity: true } },
      subsidiaries: { select: { id: true, name: true, legalName: true, isBillingEntity: true } },
      customerAliases: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!customer) {
    return <div className="p-4 text-[#FF3333]">Customer not found</div>;
  }

  const isBucket = customer.subsidiaries.length > 0;
  // Family rollup: bucket = self + all subs; leaf = just self.
  // Bills also use this set; we no longer roll UP into a parent's view.
  const familyIds: string[] = isBucket
    ? [customer.id, ...customer.subsidiaries.map((s) => s.id)]
    : [customer.id];

  const [ticketsAsPayer, invoices, supplierBillLines, customerPOsAll, effective] = await Promise.all([
    prisma.ticket.findMany({
      where: { payingCustomerId: { in: familyIds } },
      select: {
        id: true,
        title: true,
        status: true,
        ticketMode: true,
        createdAt: true,
        payingCustomerId: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.salesInvoice.findMany({
      where: { customerId: { in: familyIds } },
      select: {
        id: true,
        invoiceNo: true,
        issuedAt: true,
        dueDate: true,
        paidAt: true,
        totalSell: true,
        totalGross: true,
        status: true,
        customerId: true,
      },
      orderBy: { issuedAt: "desc" },
    }),
    prisma.supplierBillLine.findMany({
      where: { customerId: { in: familyIds } },
      include: {
        supplierBill: { include: { supplier: { select: { id: true, name: true } } } },
        ticket:       { select: { id: true, ticketNo: true, title: true } },
        site:         { select: { id: true, siteName: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    isBucket
      ? prisma.customerPO.findMany({
          where: { customerId: { in: familyIds } },
          select: { id: true, poNo: true, poType: true, status: true, totalValue: true, customerId: true },
          orderBy: { createdAt: "desc" },
          take: 30,
        })
      : Promise.resolve(customer.customerPOs),
    getEffectiveBillingDetails(customer.id),
  ]);

  // Build id → name map for the family + parent so the inherit badge can render readable names.
  const familyMap = new Map<string, string>();
  familyMap.set(customer.id, customer.name);
  for (const s of customer.subsidiaries) familyMap.set(s.id, s.name);
  if (customer.parentEntity) familyMap.set(customer.parentEntity.id, customer.parentEntity.name);

  // The effective getter walks UP the parent chain — collect any ancestor names not already in familyMap.
  if (effective) {
    const sourceIds = Array.from(
      new Set(Object.values(effective.sources).filter((v): v is string => typeof v === "string"))
    ).filter((sid) => !familyMap.has(sid));
    if (sourceIds.length > 0) {
      const ancestors = await prisma.customer.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, name: true },
      });
      for (const a of ancestors) familyMap.set(a.id, a.name);
    }
  }

  const inheritSourceNames: Record<string, string> = Object.fromEntries(familyMap);

  // Tag each transaction row with the entity it actually came from (for bucket view).
  const ticketsTagged = ticketsAsPayer.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    ticketMode: t.ticketMode,
    createdAt: t.createdAt,
    sourceEntityId: t.payingCustomerId ?? null,
    sourceEntityName: t.payingCustomerId ? (familyMap.get(t.payingCustomerId) ?? null) : null,
  }));
  const invoicesTagged = invoices.map((i) => ({
    id: i.id,
    invoiceNo: i.invoiceNo,
    issuedAt: i.issuedAt,
    dueDate: i.dueDate,
    paidAt: i.paidAt,
    totalSell: i.totalSell,
    totalGross: i.totalGross,
    status: i.status,
    sourceEntityId: i.customerId,
    sourceEntityName: familyMap.get(i.customerId) ?? null,
  }));
  const customerPOsTagged = customerPOsAll.map((p) => ({
    id: p.id,
    poNo: p.poNo,
    poType: p.poType,
    status: p.status,
    totalValue: p.totalValue,
    sourceEntityId: p.customerId ?? null,
    sourceEntityName: p.customerId ? (familyMap.get(p.customerId) ?? null) : null,
  }));

  // Replace the customer's own slices with family-rolled-up arrays so existing
  // component code keeps working unchanged (it reads customer.ticketsAsPayer etc).
  const customerWithFamily = {
    ...customer,
    ticketsAsPayer: ticketsTagged,
    customerPOs: customerPOsTagged,
    invoices: invoicesTagged,
  };

  // Debt-account trackers (assumed third-party balances paid down over time).
  const debtTrackers = await prisma.customerDebtTracker.findMany({
    where: { customerId: { in: familyIds } },
    include: {
      repayments: { orderBy: { paidAt: "asc" } },
      sourceInvoices: { orderBy: { invoiceDate: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  const debtInvoiceIds = debtTrackers
    .flatMap((t) => t.repayments.map((r) => r.salesInvoiceId))
    .filter((v): v is string => !!v);
  const debtInvoices = debtInvoiceIds.length
    ? await prisma.salesInvoice.findMany({
        where: { id: { in: debtInvoiceIds } },
        select: { id: true, invoiceNo: true, status: true },
      })
    : [];
  const debtInvoiceMap = Object.fromEntries(
    debtInvoices.map((i) => [i.id, { invoiceNo: i.invoiceNo, status: i.status }])
  );

  const allSites = await prisma.site.findMany({
    select: { id: true, siteName: true },
    orderBy: { siteName: "asc" },
  });

  const allCustomers = await prisma.customer.findMany({
    where: { id: { not: id } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <CustomerDetail
        customer={s(customerWithFamily)}
        allSites={s(allSites)}
        allCustomers={s(allCustomers)}
        supplierBillLines={s(supplierBillLines)}
        isBucket={isBucket}
        effective={s(effective)}
        inheritSourceNames={inheritSourceNames}
      />
      <DebtAccountPanel
        customerId={customer.id}
        trackers={s(debtTrackers)}
        invoiceMap={debtInvoiceMap}
        invoiceOptions={invoices.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo }))}
      />
    </div>
  );
}
