import { prisma } from "@/lib/prisma";

/**
 * Nuclear option — clear ALL auto-close (T1/T2) matches at once.
 * Useful if the user decides the auto-close pass is wholesale untrustworthy.
 * Manually-confirmed matches (matchReason that doesn't start with T1/T2) are preserved.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const result = await prisma.zohoImportedBillLine.updateMany({
    where: {
      matchedInvoiceLineId: { not: null },
      OR: [{ matchReason: { startsWith: "T1" } }, { matchReason: { startsWith: "T2" } }],
    },
    data: {
      matchedInvoiceLineId: null,
      matchConfidence: null,
      matchReason: "BULK_REJECTED · auto-close output cleared",
      clearStatus: null,
      matchedAt: new Date(),
    },
  });
  return Response.json({ ok: true, cleared: result.count });
}
