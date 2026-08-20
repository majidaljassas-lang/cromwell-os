import { NextResponse } from "next/server";
import { getCleanupInsights } from "@/lib/zoho/cleanup-insights";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getCleanupInsights();
  return NextResponse.json(data);
}
