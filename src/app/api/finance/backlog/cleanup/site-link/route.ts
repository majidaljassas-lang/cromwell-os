import { NextResponse } from "next/server";
import { linkZohoSites } from "@/lib/zoho/site-linking";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { cfSites, siteId, notes, linkedBy } = body ?? {};
    if (!Array.isArray(cfSites) || cfSites.length === 0) {
      return NextResponse.json({ error: "cfSites required" }, { status: 400 });
    }
    if (typeof siteId !== "string" || !siteId) {
      return NextResponse.json({ error: "siteId required" }, { status: 400 });
    }
    const result = await linkZohoSites({ cfSites, siteId, notes, linkedBy });
    return NextResponse.json({ ok: true, linked: result.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Link failed" },
      { status: 500 }
    );
  }
}
