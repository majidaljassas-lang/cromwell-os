import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      siteCommercialLinks: {
        include: {
          site: {
            select: {
              id: true,
              siteName: true,
              siteCode: true,
              city: true,
              postcode: true,
              aliases: true,
            },
          },
        },
        where: { isActive: true },
      },
      siteContactLinks: {
        include: {
          contact: { select: { id: true, fullName: true, phone: true, email: true } },
        },
        where: { isActive: true },
      },
      ticketsAsPayer: {
        select: { id: true, title: true, status: true, ticketMode: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      customerPOs: {
        select: { id: true, poNo: true, poType: true, status: true, totalValue: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      invoices: {
        select: { id: true, invoiceNo: true, issuedAt: true, dueDate: true, paidAt: true, totalSell: true, totalGross: true, status: true },
        orderBy: { issuedAt: "desc" },
      },
      parentEntity: { select: { id: true, name: true, isBillingEntity: true } },
      subsidiaries: {
        select: { id: true, name: true, legalName: true, isBillingEntity: true },
      },
      customerAliases: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!customer) {
    return Response.json({ error: "Customer not found" }, { status: 404 });
  }

  const allSites = await prisma.site.findMany({
    select: { id: true, siteName: true },
    orderBy: { siteName: "asc" },
  });

  const allCustomers = await prisma.customer.findMany({
    where: { id: { not: id } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const familyIds: string[] = [id];
  if (customer.parentEntity?.id) familyIds.push(customer.parentEntity.id);
  for (const sub of customer.subsidiaries ?? []) familyIds.push(sub.id);

  const supplierBillLines = await prisma.supplierBillLine.findMany({
    where: { customerId: { in: familyIds } },
    include: {
      supplierBill: { include: { supplier: { select: { id: true, name: true } } } },
      ticket: { select: { id: true, ticketNo: true, title: true } },
      site: { select: { id: true, siteName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));
  return Response.json({
    customer: s(customer),
    allSites: s(allSites),
    allCustomers: s(allCustomers),
    supplierBillLines: s(supplierBillLines),
  });
}
