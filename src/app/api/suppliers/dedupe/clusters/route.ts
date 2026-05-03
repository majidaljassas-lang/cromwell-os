import { NextResponse } from "next/server";
import { findClusters } from "@/lib/suppliers/dedupe";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const t = url.searchParams.get("threshold");
  const threshold = t ? Math.max(0.3, Math.min(0.95, Number(t))) : undefined;
  const clusters = await findClusters(threshold);
  return NextResponse.json({ clusters, threshold: threshold ?? 0.65 });
}
