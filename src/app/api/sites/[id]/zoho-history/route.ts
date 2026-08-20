import { NextResponse } from "next/server";
import { getSiteZohoLines } from "@/lib/zoho/unified-views";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await getSiteZohoLines(id);
  return NextResponse.json(data);
}
