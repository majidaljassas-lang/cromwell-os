import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const inv = await prisma.zohoImportedInvoice.findUnique({
    where: { id },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    payload: inv.payload,
    lines: inv.lines.map((l) => ({
      lineNumber: l.lineNumber,
      itemName: l.itemName,
      itemDesc: l.itemDesc,
      productId: l.productId,
      sku: l.sku,
      quantity: l.quantity != null ? Number(l.quantity) : null,
      usageUnit: l.usageUnit,
      itemPrice: l.itemPrice != null ? Number(l.itemPrice) : null,
      itemTotal: l.itemTotal != null ? Number(l.itemTotal) : null,
      account: l.account,
      accountCode: l.accountCode,
      itemTaxPercent: l.itemTaxPercent != null ? Number(l.itemTaxPercent) : null,
      itemTaxAmount: l.itemTaxAmount != null ? Number(l.itemTaxAmount) : null,
      cfSite: l.cfSite,
    })),
  });
}
