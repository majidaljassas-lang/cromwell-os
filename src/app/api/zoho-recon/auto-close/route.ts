import { prisma } from "@/lib/prisma";
import {
  extractSKUs,
  extractSizes,
  classify,
  WINDOW_DAYS_DEFAULT,
} from "@/lib/reconciliation/matcher";

/**
 * Auto-close high-confidence pairs across the entire bill book.
 *
 *   T1 — SKU exact: bill description and invoice description share an SKU
 *        token (e.g. C0260, K07068). Auto-closes regardless of customer/site.
 *   T2 — Same-job: ≥3 invoice lines on a single invoice match ≥3 bill lines
 *        on a single bill by (size + product class), date within ±60 days.
 *        Auto-closes the cluster.
 *
 * Anything below this bar (T3 size+qty, T4 size only) stays for human review.
 *
 * Writes ZohoImportedBillLine.matchedInvoiceLineId, .matchConfidence,
 * .matchReason, .matchedAt, .clearStatus="CLEARED". Idempotent — bill lines
 * already matched are skipped.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST() {
  const startedAt = Date.now();
  try {
    // Pull bill lines that are NOT yet matched
    const billLines = await prisma.zohoImportedBillLine.findMany({
      where: { matchedInvoiceLineId: null },
      include: { bill: { select: { billDate: true, zohoNumber: true, vendorName: true } } },
    });
    // Pull invoice lines + their invoices (status, date)
    const invoiceLines = await prisma.zohoImportedInvoiceLine.findMany({
      include: { invoice: { select: { invoiceDate: true, zohoNumber: true, status: true } } },
    });

    // Pre-process invoice lines for fast lookup
    const invIndexBySku = new Map<string, string[]>();      // sku → [invoice line ids]
    const invIndexBySizeCls = new Map<string, string[]>();  // `${size}|${cls}` → [invoice line ids]
    const invMeta = new Map<string, { invoiceDate: Date | null; invoiceNumber: string | null; cost: number; invoiceId: string }>();

    for (const il of invoiceLines) {
      const desc = il.itemDesc || il.itemName || "";
      const skus = extractSKUs(desc);
      const sizes = extractSizes(desc);
      const cls = classify(desc);

      invMeta.set(il.id, {
        invoiceDate: il.invoice?.invoiceDate ?? null,
        invoiceNumber: il.invoice?.zohoNumber ?? null,
        cost: Number(il.itemTotal ?? 0),
        invoiceId: il.invoiceId,
      });
      for (const s of skus) {
        if (!invIndexBySku.has(s)) invIndexBySku.set(s, []);
        invIndexBySku.get(s)!.push(il.id);
      }
      if (cls) {
        for (const sz of sizes) {
          const k = `${sz}|${cls}`;
          if (!invIndexBySizeCls.has(k)) invIndexBySizeCls.set(k, []);
          invIndexBySizeCls.get(k)!.push(il.id);
        }
      }
    }

    let t1 = 0, t2 = 0;
    const updates: Array<{ id: string; matchedInvoiceLineId: string; conf: number; reason: string }> = [];

    // --- Pass 1: T1 SKU exact ---
    for (const bl of billLines) {
      const desc = bl.itemDesc || bl.itemName || "";
      const skus = extractSKUs(desc);
      if (skus.size === 0) continue;
      const billDate = bl.bill.billDate;
      if (!billDate) continue;

      // Find the closest-by-date invoice line that shares an SKU token
      let best: { invLineId: string; daysDelta: number; sku: string } | null = null;
      for (const sku of skus) {
        const candIds = invIndexBySku.get(sku) || [];
        for (const ilId of candIds) {
          const meta = invMeta.get(ilId);
          if (!meta || !meta.invoiceDate) continue;
          const days = Math.abs(billDate.getTime() - meta.invoiceDate.getTime()) / 86400000;
          if (days > WINDOW_DAYS_DEFAULT) continue;
          if (!best || days < best.daysDelta) {
            best = { invLineId: ilId, daysDelta: days, sku };
          }
        }
      }
      if (best) {
        updates.push({
          id: bl.id,
          matchedInvoiceLineId: best.invLineId,
          conf: 100,
          reason: `T1 · SKU ${best.sku} exact match · ${invMeta.get(best.invLineId)?.invoiceNumber ?? "?"}`,
        });
        t1++;
      }
    }

    // Track what's now claimed so T2 doesn't double-pair
    const claimedBillLines = new Set(updates.map((u) => u.id));
    const claimedInvLines = new Set(updates.map((u) => u.matchedInvoiceLineId));

    // --- Pass 2: T2 same-job ---
    // Group remaining unmatched bill lines by (billNo, size, cls) to find clusters
    // that map to a single invoice cluster.
    const remainingBills = billLines.filter((bl) => !claimedBillLines.has(bl.id));
    // Per bill, count invoice-line candidates per (sz|cls) and find which invoice gets ≥3 hits
    const billsByNo = new Map<string, typeof remainingBills>();
    for (const bl of remainingBills) {
      const key = bl.bill.zohoNumber || "";
      if (!key) continue;
      if (!billsByNo.has(key)) billsByNo.set(key, []);
      billsByNo.get(key)!.push(bl);
    }
    for (const [, lines] of billsByNo) {
      if (lines.length < 3) continue;
      const billDate = lines[0].bill.billDate;
      if (!billDate) continue;

      // For each line in the bill, find the (sz, cls) candidate invoice ids
      // (within window, not claimed). Tally hits per invoiceId.
      const invoiceIdHits = new Map<string, { lineMap: Map<string, string> }>(); // invoiceId → { billLineId → invLineId }
      for (const bl of lines) {
        const desc = bl.itemDesc || bl.itemName || "";
        const sizes = extractSizes(desc);
        const cls = classify(desc);
        if (!cls) continue;
        for (const sz of sizes) {
          const candIds = invIndexBySizeCls.get(`${sz}|${cls}`) || [];
          for (const ilId of candIds) {
            if (claimedInvLines.has(ilId)) continue;
            const meta = invMeta.get(ilId);
            if (!meta || !meta.invoiceDate) continue;
            const days = Math.abs(billDate.getTime() - meta.invoiceDate.getTime()) / 86400000;
            if (days > WINDOW_DAYS_DEFAULT) continue;
            const key = meta.invoiceId;
            if (!invoiceIdHits.has(key)) invoiceIdHits.set(key, { lineMap: new Map() });
            const existing = invoiceIdHits.get(key)!.lineMap.get(bl.id);
            // Prefer invoice line with closest cost
            const blCost = Number(bl.itemTotal ?? 0);
            const newDelta = Math.abs(meta.cost - blCost);
            if (existing) {
              const oldMeta = invMeta.get(existing);
              const oldDelta = oldMeta ? Math.abs(oldMeta.cost - blCost) : Infinity;
              if (newDelta < oldDelta) {
                invoiceIdHits.get(key)!.lineMap.set(bl.id, ilId);
              }
            } else {
              invoiceIdHits.get(key)!.lineMap.set(bl.id, ilId);
            }
          }
        }
      }
      // Find invoice with the most hits (≥3)
      let bestInv: { invoiceId: string; hits: number; lineMap: Map<string, string> } | null = null;
      for (const [invoiceId, info] of invoiceIdHits) {
        if (info.lineMap.size >= 3) {
          if (!bestInv || info.lineMap.size > bestInv.hits) {
            bestInv = { invoiceId, hits: info.lineMap.size, lineMap: info.lineMap };
          }
        }
      }
      if (!bestInv) continue;

      // Lock these pairings
      for (const [billLineId, invLineId] of bestInv.lineMap) {
        if (claimedInvLines.has(invLineId)) continue;
        updates.push({
          id: billLineId,
          matchedInvoiceLineId: invLineId,
          conf: 95,
          reason: `T2 · Same-job cluster · ${bestInv.hits} lines map to invoice ${invMeta.get(invLineId)?.invoiceNumber ?? "?"}`,
        });
        claimedBillLines.add(billLineId);
        claimedInvLines.add(invLineId);
        t2++;
      }
    }

    // Persist updates in batches
    let written = 0;
    const BATCH = 200;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      await prisma.$transaction(
        batch.map((u) =>
          prisma.zohoImportedBillLine.update({
            where: { id: u.id },
            data: {
              matchedInvoiceLineId: u.matchedInvoiceLineId,
              matchConfidence: u.conf,
              matchReason: u.reason,
              matchedAt: new Date(),
              clearStatus: "CLEARED",
            },
          })
        )
      );
      written += batch.length;
    }

    return Response.json({
      ok: true,
      scannedBillLines: billLines.length,
      scannedInvoiceLines: invoiceLines.length,
      closed: written,
      breakdown: { T1_sku: t1, T2_same_job: t2 },
      durationMs: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("[auto-close] failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "auto-close failed" },
      { status: 500 }
    );
  }
}
