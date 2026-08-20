import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { BacklogList } from "./BacklogList";

export const dynamic = "force-dynamic";

const TYPES = ["bills", "invoices", "payments", "contacts"] as const;
type TypeSlug = (typeof TYPES)[number];

const TITLES: Record<TypeSlug, string> = {
  bills: "BILLS",
  invoices: "INVOICES",
  payments: "PAYMENTS",
  contacts: "CONTACTS",
};

export default async function BacklogTypePage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { type } = await params;
  const { status } = await searchParams;
  if (!TYPES.includes(type as TypeSlug)) notFound();
  const slug = type as TypeSlug;

  const filterStatus = status ?? "QUARANTINED";

  const customers = await prisma.customer.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  const suppliers = await prisma.supplier.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 500,
  });

  let rows: Array<Record<string, unknown>> = [];
  if (slug === "bills") {
    const bills = await prisma.zohoImportedBill.findMany({
      where: { importStatus: filterStatus as "QUARANTINED" | "PROMOTED" | "REJECTED" },
      orderBy: { billDate: "desc" },
      take: 200,
    });
    rows = bills.map((b) => ({
      id: b.id,
      zohoNumber: b.zohoNumber,
      vendorName: b.vendorName,
      billDate: b.billDate?.toISOString().slice(0, 10) ?? null,
      total: b.total != null ? Number(b.total) : null,
      currencyCode: b.currencyCode,
      status: b.status,
      importStatus: b.importStatus,
      payload: b.payload,
    }));
  } else if (slug === "invoices") {
    const invs = await prisma.zohoImportedInvoice.findMany({
      where: { importStatus: filterStatus as "QUARANTINED" | "PROMOTED" | "REJECTED" },
      orderBy: { invoiceDate: "desc" },
      select: {
        id: true,
        zohoNumber: true,
        customerName: true,
        invoiceDate: true,
        dueDate: true,
        total: true,
        balance: true,
        currencyCode: true,
        status: true,
        importStatus: true,
        _count: { select: { lines: true } },
      },
    });
    rows = invs.map((i) => ({
      id: i.id,
      zohoNumber: i.zohoNumber,
      customerName: i.customerName,
      invoiceDate: i.invoiceDate?.toISOString().slice(0, 10) ?? null,
      dueDate: i.dueDate?.toISOString().slice(0, 10) ?? null,
      total: i.total != null ? Number(i.total) : null,
      balance: i.balance != null ? Number(i.balance) : null,
      currencyCode: i.currencyCode,
      status: i.status,
      importStatus: i.importStatus,
      lineCount: i._count.lines,
    }));
  } else if (slug === "payments") {
    const pays = await prisma.zohoImportedPayment.findMany({
      where: { importStatus: filterStatus as "QUARANTINED" | "PROMOTED" | "REJECTED" },
      orderBy: { paymentDate: "desc" },
      take: 200,
    });
    rows = pays.map((p) => ({
      id: p.id,
      paymentSide: p.paymentSide,
      contactName: p.contactName,
      paymentDate: p.paymentDate?.toISOString().slice(0, 10) ?? null,
      amount: p.amount != null ? Number(p.amount) : null,
      paymentMode: p.paymentMode,
      reference: p.reference,
      importStatus: p.importStatus,
      payload: p.payload,
    }));
  } else if (slug === "contacts") {
    const contacts = await prisma.zohoImportedContact.findMany({
      where: { importStatus: filterStatus as "QUARANTINED" | "PROMOTED" | "REJECTED" },
      orderBy: { contactName: "asc" },
      take: 500,
    });
    rows = contacts.map((c) => ({
      id: c.id,
      contactName: c.contactName,
      companyName: c.companyName,
      contactType: c.contactType,
      email: c.email,
      phone: c.phone,
      vatNumber: c.vatNumber,
      importStatus: c.importStatus,
      payload: c.payload,
    }));
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          BACKLOG · {TITLES[slug]}
        </h1>
        <div className="flex gap-2 text-[10px]">
          {(["QUARANTINED", "PROMOTED", "REJECTED"] as const).map((s) => (
            <a
              key={s}
              href={`/finance/backlog/${slug}?status=${s}`}
              className={`px-2 py-1 border ${
                filterStatus === s
                  ? "border-[#FF6600] text-[#FF6600] font-bold"
                  : "border-[#333333] text-[#888888]"
              }`}
            >
              {s}
            </a>
          ))}
        </div>
      </div>

      <BacklogList
        type={slug}
        rows={rows}
        customers={customers}
        suppliers={suppliers}
      />
    </div>
  );
}
