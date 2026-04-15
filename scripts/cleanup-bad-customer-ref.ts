/**
 * One-shot cleanup: null out SupplierBill.customerRef where it equals the
 * supplier's name — caused by the zoho-parser.ts:75 bug that used
 * payload.vendor_name as customerRef.
 *
 * Run: `npx tsx scripts/cleanup-bad-customer-ref.ts`
 * Idempotent — safe to re-run.
 */
import { prisma } from "@/lib/prisma";

async function main() {
  const bills = await prisma.supplierBill.findMany({
    where: { customerRef: { not: null } },
    select: { id: true, customerRef: true, supplier: { select: { name: true } } },
  });

  let cleared = 0;
  for (const b of bills) {
    const ref = (b.customerRef || "").trim().toLowerCase();
    const sup = (b.supplier?.name || "").trim().toLowerCase();
    if (ref && sup && ref === sup) {
      await prisma.supplierBill.update({
        where: { id: b.id },
        data: { customerRef: null },
      });
      cleared++;
    }
  }
  console.log(`Cleared customerRef on ${cleared} bills (of ${bills.length} with non-null)`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
