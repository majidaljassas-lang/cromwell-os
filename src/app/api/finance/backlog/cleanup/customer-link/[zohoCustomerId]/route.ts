import { NextResponse } from "next/server";
import { unlinkZohoCustomer } from "@/lib/zoho/customer-linking";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ zohoCustomerId: string }> }
) {
  const { zohoCustomerId } = await params;
  try {
    await unlinkZohoCustomer(zohoCustomerId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unlink failed" },
      { status: 500 }
    );
  }
}
