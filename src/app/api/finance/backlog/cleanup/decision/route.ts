import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["VOID_IN_ZOHO", "REBILL", "IGNORE", "ANOMALY_REVIEWED", "NONE"]);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { invoiceIds, decision, note, decidedBy } = body ?? {};
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return NextResponse.json({ error: "invoiceIds required" }, { status: 400 });
    }
    if (typeof decision !== "string" || !ALLOWED.has(decision)) {
      return NextResponse.json(
        { error: `decision must be one of ${[...ALLOWED].join(", ")}` },
        { status: 400 }
      );
    }
    const result = await prisma.zohoImportedInvoice.updateMany({
      where: { id: { in: invoiceIds } },
      data: {
        cleanupDecision: decision === "NONE" ? null : decision,
        cleanupDecisionAt: decision === "NONE" ? null : new Date(),
        cleanupDecisionBy: decision === "NONE" ? null : decidedBy ?? null,
        cleanupDecisionNote: decision === "NONE" ? null : note ?? null,
      },
    });
    return NextResponse.json({ ok: true, updated: result.count });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Decision failed" },
      { status: 500 }
    );
  }
}
