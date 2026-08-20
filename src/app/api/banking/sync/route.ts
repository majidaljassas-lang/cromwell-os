// POST /api/banking/sync
// User-triggered manual sync. Runs the same engine as the scheduler.

import { NextResponse } from "next/server";
import { syncAllConnections } from "@/lib/truelayer/sync";

export async function POST() {
  const summary = await syncAllConnections();
  return NextResponse.json(summary);
}
