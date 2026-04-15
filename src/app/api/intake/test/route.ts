/**
 * POST /api/intake/test — Bills Intake Engine acceptance test (run against dev server).
 *
 * Seeds supplier + customer + site + 4 tickets + 1 bill (3 lines), runs the
 * allocation engine, asserts, and reports pass/fail JSON. Deletes seed data
 * unless ?keep=1 is passed.
 *
 * Curl:  curl -X POST http://localhost:3000/api/intake/test
 */

import { prisma } from "@/lib/prisma";
import { allocateBillLine } from "@/lib/intake/allocation-engine";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const keep = url.searchParams.get("keep") === "1";

  const TAG = `IntakeEngineTest_${Date.now()}`;
  const PROD_A = "TESTPIPEA28MM";
  const PROD_D = "TESTSCREWMOQ";
  const PROD_G = "TESTELBOW22GRP";
  const cleanup: Array<() => Promise<void>> = [];
  const log: string[] = [];

  try {
    const supplier = await prisma.supplier.create({ data: { name: `${TAG} Supplier` } });
    cleanup.push(async () => { await prisma.supplier.delete({ where: { id: supplier.id } }).catch(() => {}); });

    const customer = await prisma.customer.create({ data: { name: `${TAG} Customer` } });
    cleanup.push(async () => { await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {}); });

    const site = await prisma.site.create({ data: { siteName: `${TAG} Site` } });
    cleanup.push(async () => { await prisma.site.delete({ where: { id: site.id } }).catch(() => {}); });

    async function mkTicket(suffix: string, productToken: string, qty: number) {
      const t = await prisma.ticket.create({
        data: {
          title:            `${TAG} ticket ${suffix} (${productToken})`,
          ticketMode:       "DIRECT_ORDER",
          status:           "ORDERED",
          siteId:           site.id,
          payingCustomerId: customer.id,
        },
      });
      cleanup.push(async () => { await prisma.ticket.delete({ where: { id: t.id } }).catch(() => {}); });

      const tl = await prisma.ticketLine.create({
        data: {
          ticketId:         t.id,
          lineType:         "MATERIAL",
          description:      `${productToken} 28mm copper testpipe length needed`,
          qty,
          unit:             "EA",
          status:           "ORDERED",
          siteId:           site.id,
          payingCustomerId: customer.id,
        },
      });
      cleanup.push(async () => { await prisma.ticketLine.delete({ where: { id: tl.id } }).catch(() => {}); });
      return { ticket: t, line: tl };
    }

    await mkTicket("A", PROD_A, 6);
    await mkTicket("B", PROD_G, 5);
    await mkTicket("C", PROD_G, 3);
    await mkTicket("D", PROD_D, 6);

    const bill = await prisma.supplierBill.create({
      data: {
        supplierId: supplier.id,
        billNo:     `${TAG}-BILL`,
        billDate:   new Date(),
        status:     "PENDING",
        totalCost:  (6 * 10) + (10 * 1) + (8 * 5),
      },
    });
    cleanup.push(async () => { await prisma.supplierBill.delete({ where: { id: bill.id } }).catch(() => {}); });

    async function mkBillLine(description: string, qty: number, unitCost: number) {
      const bl = await prisma.supplierBillLine.create({
        data: {
          supplierBillId:     bill.id,
          description,
          qty,
          unitCost,
          lineTotal:          qty * unitCost,
          costClassification: "BILLABLE",
          allocationStatus:   "UNALLOCATED",
          originalUom:        "EA",
        },
      });
      cleanup.push(async () => { await prisma.supplierBillLine.delete({ where: { id: bl.id } }).catch(() => {}); });
      return bl;
    }

    const line1 = await mkBillLine(`${PROD_A} 28mm copper testpipe length supply`, 6, 10);
    const line2 = await mkBillLine(`${PROD_D} 28mm copper testpipe length supply`, 10, 1);
    const line3 = await mkBillLine(`${PROD_G} 28mm copper testpipe length supply`, 8, 5);

    const r1 = await allocateBillLine(line1.id);
    const r2 = await allocateBillLine(line2.id);
    const r3 = await allocateBillLine(line3.id);

    const failures: string[] = [];
    const assert = (cond: boolean, msg: string) => { if (!cond) failures.push(msg); };

    // Line 1 — clean 6 EA match
    assert(r1.totalQtyAllocated === 6, `line1: total qty expected 6, got ${r1.totalQtyAllocated}`);
    const l1t = r1.allocations.filter((a) => a.type === "TICKET_LINE");
    assert(l1t.length >= 1, `line1: expected ≥1 TICKET_LINE, got ${l1t.length}`);
    assert(l1t.reduce((s, a) => s + a.qty, 0) === 6, `line1: ticket allocation should sum to 6`);

    // Line 2 — MOQ overbuy (10 vs 6 needed)
    assert(r2.totalQtyAllocated === 10, `line2: total qty expected 10, got ${r2.totalQtyAllocated}`);
    const l2t = r2.allocations.filter((a) => a.type === "TICKET_LINE");
    const l2s = r2.allocations.filter((a) => a.type !== "TICKET_LINE");
    assert(l2t.reduce((s, a) => s + a.qty, 0) >= 6, `line2: ticket allocation expected ≥6`);
    assert(l2s.reduce((s, a) => s + a.qty, 0) > 0, `line2: expected surplus allocation`);

    // Line 3 — grouped across tickets B (5) + C (3) = 8
    assert(r3.totalQtyAllocated === 8, `line3: total qty expected 8, got ${r3.totalQtyAllocated}`);
    const l3t = r3.allocations.filter((a) => a.type === "TICKET_LINE");
    assert(l3t.length >= 2, `line3: expected grouped across ≥2 tickets, got ${l3t.length}`);
    assert(l3t.reduce((s, a) => s + a.qty, 0) === 8, `line3: grouped sum must equal 8`);

    log.push(`line1 → ${r1.allocations.map((a) => `${a.type}:${a.qty}`).join(", ")}`);
    log.push(`line2 → ${r2.allocations.map((a) => `${a.type}:${a.qty}`).join(", ")}`);
    log.push(`line3 → ${r3.allocations.map((a) => `${a.type}:${a.qty}`).join(", ")}`);

    const pass = failures.length === 0;
    return Response.json({
      pass,
      failures,
      log,
      results: { line1: r1, line2: r2, line3: r3 },
      seedTag: TAG,
    }, { status: pass ? 200 : 500 });
  } catch (e) {
    return Response.json({
      pass: false,
      error: e instanceof Error ? e.message : "unknown",
      stack: e instanceof Error ? e.stack : null,
      log,
    }, { status: 500 });
  } finally {
    if (!keep) {
      for (const fn of cleanup.reverse()) { await fn(); }
    }
  }
}
