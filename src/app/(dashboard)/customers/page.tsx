import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { CustomersTable } from "@/components/customers/customers-table";
import { QuickAddCashClient } from "@/components/customers/quick-add-cash-client";

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const [customers, autoIntakeCount, reviewCount] = await Promise.all([
    prisma.customer.findMany({
      include: {
        siteCommercialLinks: true,
        subsidiaries: { select: { id: true, name: true } },
        invoices: {
          select: { id: true, totalSell: true, status: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.customer.count({ where: { name: { contains: "(auto-intake)" } } }),
    prisma.reviewQueueItem.count({
      where: {
        queueType: "UNRESOLVED_CUSTOMER",
        status: { in: ["OPEN_REVIEW", "IN_PROGRESS_REVIEW"] },
      },
    }),
  ]);

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
      <div className="flex justify-end">
        <QuickAddCashClient />
      </div>
      {reviewCount > 0 && (
        <Link
          href="/parties/review"
          className="flex items-center gap-2 rounded border border-[#FF6600]/40 bg-[#FF6600]/10 px-3 py-2 text-xs text-[#E0E0E0] hover:bg-[#FF6600]/20"
        >
          <AlertTriangle className="size-4 text-[#FF9900]" />
          <span>
            {reviewCount} unknown sender{reviewCount === 1 ? "" : "s"} pending review — match
            to existing customer or create.
          </span>
          <span className="ml-auto underline">Review →</span>
        </Link>
      )}
      {autoIntakeCount > 0 && (
        <Link
          href="/customers/cleanup"
          className="flex items-center gap-2 rounded border border-[#FF6600]/40 bg-[#FF6600]/10 px-3 py-2 text-xs text-[#E0E0E0] hover:bg-[#FF6600]/20"
        >
          <AlertTriangle className="size-4 text-[#FF9900]" />
          <span>
            {autoIntakeCount} auto-intake customer{autoIntakeCount === 1 ? "" : "s"} need
            reassignment — they distort reporting until merged into the real customer.
          </span>
          <span className="ml-auto underline">Clean up →</span>
        </Link>
      )}
      <CustomersTable customers={s(customersWithBalances)} />
    </div>
  );
}
