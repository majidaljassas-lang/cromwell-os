import { NextResponse } from "next/server";
import { getCustomerZohoInvoices } from "@/lib/zoho/unified-views";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const invoices = await getCustomerZohoInvoices(id);
  return NextResponse.json({ invoices });
}
