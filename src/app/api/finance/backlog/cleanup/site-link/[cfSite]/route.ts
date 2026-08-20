import { NextResponse } from "next/server";
import { unlinkZohoSite } from "@/lib/zoho/site-linking";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ cfSite: string }> }
) {
  const { cfSite } = await params;
  try {
    await unlinkZohoSite(decodeURIComponent(cfSite));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unlink failed" },
      { status: 500 }
    );
  }
}
