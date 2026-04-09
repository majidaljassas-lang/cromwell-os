import { prisma } from "@/lib/prisma";
import { CustomersTable } from "@/components/customers/customers-table";

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const customers = await prisma.customer.findMany({
    include: {
      siteCommercialLinks: true,
      subsidiaries: { select: { id: true, name: true } },
      invoices: {
        select: { id: true, totalSell: true, status: true },
      },
    },
    orderBy: { name: "asc" },
  });

  // Compute balance data per customer
  const customersWithBalances = customers.map((c: typeof customers[number]) => {
    const totalInvoiced = c.invoices.reduce(
      (sum: number, inv: { totalSell: unknown }) => sum + Number(inv.totalSell),
      0
    );
    const totalPaid = c.invoices
      .filter((inv: { status: string }) => inv.status === "PAID")
      .reduce((sum: number, inv: { totalSell: unknown }) => sum + Number(inv.totalSell), 0);
    const outstanding = totalInvoiced - totalPaid;

    return {
      id: c.id,
      name: c.name,
      legalName: c.legalName,
      billingAddress: c.billingAddress,
      vatNumber: c.vatNumber,
      paymentTerms: c.paymentTerms,
      poRequiredDefault: c.poRequiredDefault,
      isCashCustomer: c.isCashCustomer,
      parentCustomerEntityId: c.parentCustomerEntityId,
      notes: c.notes,
      siteCommercialLinks: c.siteCommercialLinks.map((l: { id: string }) => ({ id: l.id })),
      subsidiaries: c.subsidiaries,
      totalInvoiced,
      totalPaid,
      outstanding,
    };
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <CustomersTable customers={s(customersWithBalances)} />
    </div>
  );
}
