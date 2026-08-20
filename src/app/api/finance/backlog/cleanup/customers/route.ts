import { NextResponse } from "next/server";
import { listZohoCustomers } from "@/lib/zoho/cleanup-lists";
import { suggestCustomerMatches } from "@/lib/zoho/customer-linking";
import { fuzzyGroup } from "@/lib/zoho/fuzzy-grouping";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search");
  if (search) {
    const matches = await suggestCustomerMatches(search, 20);
    return NextResponse.json({ matches });
  }
  const rows = await listZohoCustomers();
  if (url.searchParams.get("groups") === "1") {
    const unmapped = rows.filter((r) => !r.linkedCustomerId);
    const groups = fuzzyGroup(unmapped, (r) => r.zohoCustomerName ?? "");
    return NextResponse.json({
      rows,
      groups: groups.map((g) => ({
        label: g.label,
        memberIds: g.members.map((m) => m.zohoCustomerId),
      })),
    });
  }
  return NextResponse.json({ rows });
}
