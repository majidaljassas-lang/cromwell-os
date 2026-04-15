/**
 * POST /api/pricing/suggest
 *
 * Body: { customerId: string; description: string; qty?: number }
 *
 * Returns suggested unit prices for a line item, ranked by relevance:
 *   1. customerHistory  — past invoice/quote lines we charged this customer (or their family)
 *   2. familyHistory    — past prices for parent customer or sibling customers
 *   3. allCustomersHistory — same/similar product across any customer
 *   4. extrapolated     — derived from a similar size/variant in the same product family
 *
 * Each suggestion includes: unitPrice, basis, sourceRef, customerName, observed at, confidence.
 */
import { prisma } from "@/lib/prisma";

const STOP = new Set(["the","and","with","for","x","of","mm","ea","pack","press","new","old","size"]);
function tokenise(s: string): Set<string> {
  return new Set((s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 2 && !STOP.has(w)));
}
function tokenScore(a: string, b: string): { shared: number; ratio: number } {
  const A = tokenise(a), B = tokenise(b);
  if (A.size === 0 || B.size === 0) return { shared: 0, ratio: 0 };
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return { shared, ratio: shared / Math.min(A.size, B.size) };
}

type Suggestion = {
  unitPrice: number;
  qty: number;
  basis: "CUSTOMER_HISTORY" | "FAMILY_HISTORY" | "ALL_CUSTOMERS" | "EXTRAPOLATED";
  source: "INVOICE" | "QUOTE";
  sourceRef: string;
  sourceStatus: string;
  customerName: string;
  description: string;
  observedAt: string | null;
  shared: number;
  confidence: number;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as { customerId?: string; description?: string; qty?: number };
    const description = (body.description ?? "").trim();
    if (!description) return Response.json({ suggestions: [] });

    // Resolve the customer family (parent + siblings)
    const familyIds = new Set<string>();
    if (body.customerId) {
      familyIds.add(body.customerId);
      const c = await prisma.customer.findUnique({
        where: { id: body.customerId },
        select: { parentCustomerEntityId: true },
      });
      if (c?.parentCustomerEntityId) {
        familyIds.add(c.parentCustomerEntityId);
        const siblings = await prisma.customer.findMany({
          where: { parentCustomerEntityId: c.parentCustomerEntityId },
          select: { id: true },
        });
        for (const s of siblings) familyIds.add(s.id);
      }
    }

    const wanted = tokenise(description);
    const wantedTokens = [...wanted];
    if (wantedTokens.length === 0) return Response.json({ suggestions: [] });

    // Pull broad candidate set: any invoice line / quote line where description shares ≥1 token
    const orClauses = wantedTokens.slice(0, 6).map((t) => ({ description: { contains: t, mode: "insensitive" as const } }));

    const [invoiceLines, quoteLines] = await Promise.all([
      prisma.salesInvoiceLine.findMany({
        where: {
          OR: orClauses,
          salesInvoice: { status: { in: ["DRAFT", "SENT", "PAID"] } },
        },
        select: {
          description: true, qty: true, unitPrice: true,
          salesInvoice: { select: { invoiceNo: true, status: true, customerId: true, issuedAt: true, customer: { select: { name: true } } } },
        },
        take: 200,
        orderBy: { createdAt: "desc" },
      }),
      prisma.quoteLine.findMany({
        where: { OR: orClauses },
        select: {
          description: true, qty: true, unitPrice: true,
          quote: { select: { quoteNo: true, status: true, customerId: true, createdAt: true, customer: { select: { name: true } } } },
        },
        take: 100,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const all: Suggestion[] = [];
    for (const l of invoiceLines) {
      const { shared, ratio } = tokenScore(description, l.description);
      if (shared < 2) continue;
      const cid = l.salesInvoice?.customerId ?? "";
      const basis: Suggestion["basis"] = familyIds.has(cid)
        ? (cid === body.customerId ? "CUSTOMER_HISTORY" : "FAMILY_HISTORY")
        : "ALL_CUSTOMERS";
      all.push({
        unitPrice: Number(l.unitPrice),
        qty: Number(l.qty),
        basis,
        source: "INVOICE",
        sourceRef: l.salesInvoice?.invoiceNo ?? "",
        sourceStatus: l.salesInvoice?.status ?? "",
        customerName: l.salesInvoice?.customer?.name ?? "",
        description: l.description,
        observedAt: l.salesInvoice?.issuedAt?.toISOString() ?? null,
        shared,
        confidence: Math.round(
          ratio * 60
          + (basis === "CUSTOMER_HISTORY" ? 30 : basis === "FAMILY_HISTORY" ? 20 : 5)
          + (l.salesInvoice?.status === "PAID" ? 10 : l.salesInvoice?.status === "SENT" ? 5 : 0)
        ),
      });
    }
    for (const l of quoteLines) {
      const { shared, ratio } = tokenScore(description, l.description);
      if (shared < 2) continue;
      const cid = l.quote?.customerId ?? "";
      const basis: Suggestion["basis"] = familyIds.has(cid)
        ? (cid === body.customerId ? "CUSTOMER_HISTORY" : "FAMILY_HISTORY")
        : "ALL_CUSTOMERS";
      all.push({
        unitPrice: Number(l.unitPrice),
        qty: Number(l.qty),
        basis,
        source: "QUOTE",
        sourceRef: l.quote?.quoteNo ?? "",
        sourceStatus: l.quote?.status ?? "",
        customerName: l.quote?.customer?.name ?? "",
        description: l.description,
        observedAt: l.quote?.createdAt?.toISOString() ?? null,
        shared,
        confidence: Math.round(ratio * 50 + (basis === "CUSTOMER_HISTORY" ? 25 : basis === "FAMILY_HISTORY" ? 15 : 5)),
      });
    }

    // Sort: customer history first, then family, then all, then by confidence
    const basisOrder: Record<Suggestion["basis"], number> = {
      CUSTOMER_HISTORY: 3, FAMILY_HISTORY: 2, ALL_CUSTOMERS: 1, EXTRAPOLATED: 0,
    };
    all.sort((a, b) => basisOrder[b.basis] - basisOrder[a.basis] || b.confidence - a.confidence);

    // Dedupe by (unitPrice, basis, sourceRef)
    const seen = new Set<string>();
    const unique = all.filter((s) => {
      const k = `${s.unitPrice.toFixed(2)}|${s.basis}|${s.sourceRef}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 12);

    return Response.json({ suggestions: unique });
  } catch (e) {
    console.error("/api/pricing/suggest failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
