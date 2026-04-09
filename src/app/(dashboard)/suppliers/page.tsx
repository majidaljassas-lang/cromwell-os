import { prisma } from "@/lib/prisma";
import { SuppliersTable } from "@/components/suppliers/suppliers-table";

export const dynamic = 'force-dynamic';

export default async function SuppliersPage() {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    include: {
      supplierBills: {
        select: {
          id: true,
          billNo: true,
          billDate: true,
          status: true,
          totalCost: true,
        },
      },
      creditNotes: {
        select: {
          id: true,
          creditNoteNo: true,
          dateReceived: true,
          status: true,
          totalCredit: true,
        },
      },
      procurementOrders: {
        select: {
          id: true,
          poNo: true,
          status: true,
          issuedAt: true,
          totalCostExpected: true,
        },
        orderBy: { issuedAt: "desc" },
        take: 10,
      },
      returns: {
        select: {
          id: true,
          returnDate: true,
          status: true,
          notes: true,
        },
        orderBy: { returnDate: "desc" },
        take: 10,
      },
    },
  });

  // Serialize to plain objects and calculate balances
  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  const suppliersWithBalances = suppliers.map((sup: typeof suppliers[number]) => {
    const totalOwing = sup.supplierBills.reduce(
      (sum: number, bill: { totalCost: unknown }) => sum + Number(bill.totalCost),
      0
    );
    const totalCredits = sup.creditNotes.reduce(
      (sum: number, cn: { totalCredit: unknown }) => sum + Number(cn.totalCredit),
      0
    );
    const netBalance = totalOwing - totalCredits;

    // Parse payment terms and accountRef from notes field
    // Format: "paymentTerms:Net 30\naccountRef:ABC123\n---\nActual notes here"
    let paymentTerms: string | null = null;
    let accountRef: string | null = null;
    let cleanNotes: string | null = sup.notes;

    if (sup.notes) {
      const lines = sup.notes.split("\n");
      const noteLines: string[] = [];
      let pastMeta = false;

      for (const line of lines) {
        if (pastMeta) {
          noteLines.push(line);
        } else if (line === "---") {
          pastMeta = true;
        } else if (line.startsWith("paymentTerms:")) {
          paymentTerms = line.replace("paymentTerms:", "").trim();
        } else if (line.startsWith("accountRef:")) {
          accountRef = line.replace("accountRef:", "").trim();
        } else {
          // If we hit a line that's not meta, treat everything from here as notes
          pastMeta = true;
          noteLines.push(line);
        }
      }

      cleanNotes = noteLines.join("\n").trim() || null;
    }

    return {
      id: sup.id,
      name: sup.name,
      legalName: sup.legalName,
      email: sup.email,
      phone: sup.phone,
      notes: sup.notes,
      cleanNotes,
      paymentTerms,
      accountRef,
      totalOwing,
      totalCredits,
      netBalance,
      recentOrders: s(sup.procurementOrders),
      recentBills: s(sup.supplierBills.slice(0, 10)),
      recentReturns: s(sup.returns),
    };
  });

  return (
    <div className="p-4 space-y-4">
      <SuppliersTable suppliers={suppliersWithBalances} />
    </div>
  );
}
