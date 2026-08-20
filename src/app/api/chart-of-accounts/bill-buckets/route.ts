import { prisma } from "@/lib/prisma";

// Bills post to exactly 4 GL buckets. The friendly label is what Majid uses
// in conversation; accountCode + accountName are the truth from
// ChartOfAccount. Returned ordered by accountCode.
const BILL_BUCKET_LABELS: Record<string, string> = {
  "5000": "MATERIALS",
  "5100": "LABOUR",
  "5200": "LOGISTICS",
  "5400": "PLANT HIRE",
};

export async function GET() {
  try {
    const rows = await prisma.chartOfAccount.findMany({
      where: { accountCode: { in: Object.keys(BILL_BUCKET_LABELS) } },
      select: { id: true, accountCode: true, accountName: true },
      orderBy: { accountCode: "asc" },
    });

    return Response.json(
      rows.map((r) => ({
        id: r.id,
        accountCode: r.accountCode,
        accountName: r.accountName,
        label: BILL_BUCKET_LABELS[r.accountCode] ?? r.accountName,
      })),
    );
  } catch (error) {
    console.error("Failed to fetch bill GL buckets:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch buckets" },
      { status: 500 },
    );
  }
}
