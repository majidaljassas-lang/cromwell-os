// POST /api/banking/connect
// Body: { providerName: string, displayName: string }
// Creates a PENDING BankConnection and returns the TrueLayer auth URL the user
// should be redirected to. State token is stored on the connection so the
// callback can find it.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { buildAuthUrl, isConfigured } from "@/lib/truelayer/client";

export async function POST(req: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "TrueLayer not configured. Set TRUELAYER_CLIENT_ID and TRUELAYER_CLIENT_SECRET." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const providerName = (body.providerName as string | undefined)?.trim();
  const displayName = (body.displayName as string | undefined)?.trim();

  if (!providerName || !displayName) {
    return NextResponse.json(
      { error: "providerName and displayName required" },
      { status: 400 },
    );
  }

  const state = randomBytes(16).toString("hex");

  const conn = await prisma.bankConnection.create({
    data: {
      provider: "TRUELAYER",
      providerName,
      displayName,
      providerConnectionId: state, // temp — overwritten with credentials_id on callback
      status: "PENDING",
    },
  });

  const authUrl = buildAuthUrl({ state, providers: providerName });

  return NextResponse.json({ authUrl, connectionId: conn.id });
}
