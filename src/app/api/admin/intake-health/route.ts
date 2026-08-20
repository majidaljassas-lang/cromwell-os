import { NextResponse } from "next/server";
import { getIntakeHealthSnapshot } from "@/lib/scheduler/heartbeat-monitor";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getIntakeHealthSnapshot();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
