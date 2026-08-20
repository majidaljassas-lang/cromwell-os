import { NextResponse } from "next/server";
import { linkZohoCustomers } from "@/lib/zoho/customer-linking";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { zohoCustomerIds, customerId, notes, linkedBy } = body ?? {};
    if (!Array.isArray(zohoCustomerIds) || zohoCustomerIds.length === 0) {
      return NextResponse.json({ error: "zohoCustomerIds required" }, { status: 400 });
    }
    if (typeof customerId !== "string" || !customerId) {
      return NextResponse.json({ error: "customerId required" }, { status: 400 });
    }
    const result = await linkZohoCustomers({ zohoCustomerIds, customerId, notes, linkedBy });
    return NextResponse.json({ ok: true, linked: result.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Link failed" },
      { status: 500 }
    );
  }
}
