import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const NINETY_DAYS_MS = 90 * 86400000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const queue = url.searchParams.get("queue") ?? "stale";
  const today = new Date();

  let where: object = {};
  let orderBy: object = { invoiceDate: "asc" };
  if (queue === "stale") {
    where = {
      status: { in: ["Draft", "Open", "Pending"] },
      invoiceDate: { lt: new Date(today.getTime() - NINETY_DAYS_MS) },
    };
  } else if (queue === "void-with-balance") {
    where = { status: "Void", balance: { gt: 0 } };
    orderBy = { balance: "desc" };
  } else if (queue === "zero-total") {
    where = { OR: [{ total: null }, { total: 0 }] };
    orderBy = { invoiceDate: "desc" };
  } else if (queue === "cash-account") {
    where = { customerName: { contains: "Cash Account", mode: "insensitive" } };
    orderBy = { invoiceDate: "desc" };
  }

  const rows = await prisma.zohoImportedInvoice.findMany({
    where,
    orderBy,
    select: {
      id: true,
      zohoNumber: true,
      customerName: true,
      invoiceDate: true,
      dueDate: true,
      total: true,
      balance: true,
      status: true,
      cleanupDecision: true,
      cleanupDecisionAt: true,
      cleanupDecisionNote: true,
    },
    take: 1000,
  });

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      zohoNumber: r.zohoNumber,
      customerName: r.customerName,
      invoiceDate: r.invoiceDate?.toISOString().slice(0, 10) ?? null,
      dueDate: r.dueDate?.toISOString().slice(0, 10) ?? null,
      total: r.total != null ? Number(r.total) : null,
      balance: r.balance != null ? Number(r.balance) : null,
      status: r.status,
      cleanupDecision: r.cleanupDecision,
      cleanupDecisionAt: r.cleanupDecisionAt?.toISOString() ?? null,
      cleanupDecisionNote: r.cleanupDecisionNote,
    })),
  });
}
