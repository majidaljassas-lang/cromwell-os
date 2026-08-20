import { NextResponse } from "next/server";
import { listZohoSites } from "@/lib/zoho/cleanup-lists";
import { suggestSiteMatches } from "@/lib/zoho/site-linking";
import { fuzzyGroup } from "@/lib/zoho/fuzzy-grouping";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search");
  if (search) {
    const matches = await suggestSiteMatches(search, 20);
    return NextResponse.json({ matches });
  }
  const rows = await listZohoSites();
  if (url.searchParams.get("groups") === "1") {
    const unmapped = rows.filter((r) => !r.linkedSiteId);
    const groups = fuzzyGroup(unmapped, (r) => r.cfSite);
    return NextResponse.json({
      rows,
      groups: groups.map((g) => ({
        label: g.label,
        memberIds: g.members.map((m) => m.cfSite),
      })),
    });
  }
  return NextResponse.json({ rows });
}
