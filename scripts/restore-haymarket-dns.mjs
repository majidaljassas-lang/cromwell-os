import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const TICKET = "55f6be03-f781-4d6b-888a-660ff38bd27a";

// Reconstructed from the signed delivery-note photos (DN1, DN4) + subtraction (DN2).
// DN3 = call-off 2 delivered in full (generated from its call-off lines).
// Each line: [token matched against the call-off description, delivered, backOrder, status]
const DN1 = {
  callOffNo: 3, date: "2026-06-02", signedBy: "Konako Monihar",
  lines: [
    ["FE15", 50, 0, "DELIVERED"], ["Brass Plug", 50, 0, "DELIVERED"],
    ["4x40mm", 700, 0, "DELIVERED"], ["5x40mm", 700, 0, "DELIVERED"], ["5x50mm", 700, 0, "DELIVERED"],
    ["6mm x 35mm wall plugs", 0, 700, "BACK_ORDER"], ["7mm x 35mm wall plugs", 500, 0, "DELIVERED"],
    ["Hexagon Flange Head", 400, 0, "DELIVERED"],
    ["12.0 x 160", 0, 30, "BACK_ORDER"], ["5.5 x 160", 0, 30, "BACK_ORDER"], ["6.0 x 160", 0, 30, "BACK_ORDER"],
    ["6.5 x 160", 0, 30, "BACK_ORDER"], ["7.0 x 160", 0, 30, "BACK_ORDER"],
    ["Multi-Purpose Cutting Disc", 100, 0, "DELIVERED"], ["A662100", 3, 0, "DELIVERED"],
    ["Jet-Lube", 5, 0, "DELIVERED"], ["Loctite 55", 20, 0, "DELIVERED"],
    ["Universal Silicone Sealant", 10, 0, "DELIVERED"],
    ["TPCS Talon", 10, 0, "DELIVERED"], ["TPC15", 10, 0, "DELIVERED"], ["TPC22", 10, 0, "DELIVERED"],
    ["MSTR110", 0, 300, "BACK_ORDER"], ["MSTR63", 40, 0, "DELIVERED"], ["MSTR90", 0, 10, "BACK_ORDER"],
    ["MSTR160", 0, 100, "BACK_ORDER"], ["MSTR22", 500, 0, "DELIVERED"], ["MSTR15", 100, 400, "PARTIAL"],
    ["MSTR42", 0, 500, "BACK_ORDER"], ["MSTR54", 0, 50, "BACK_ORDER"],
  ],
};
const DN2 = {
  callOffNo: 3, date: "2026-06-08", signedBy: null,
  lines: [
    ["6mm x 35mm wall plugs", 700, 0, "DELIVERED"],
    ["12.0 x 160", 30, 0, "DELIVERED"], ["5.5 x 160", 30, 0, "DELIVERED"], ["6.0 x 160", 30, 0, "DELIVERED"],
    ["6.5 x 160", 17, 13, "PARTIAL"], ["7.0 x 160", 30, 0, "DELIVERED"],
    ["SG100", 10, 0, "DELIVERED"],
    ["MSTR110", 85, 215, "PARTIAL"], ["MSTR90", 0, 10, "BACK_ORDER"], ["MSTR160", 100, 0, "DELIVERED"],
    ["MSTR15", 400, 0, "DELIVERED"], ["MSTR42", 500, 0, "DELIVERED"], ["MSTR54", 50, 0, "DELIVERED"],
  ],
};
const DN4 = {
  callOffNo: 3, date: "2026-06-20", signedBy: "Bikrora",
  lines: [
    ["6.5 x 160", 13, 0, "DELIVERED"], ["MSTR110", 215, 0, "DELIVERED"], ["MSTR90", 10, 0, "DELIVERED"],
  ],
};
// DN3 generated below from call-off 2 (full delivery), inserted between DN2 and DN4.

async function main() {
  const callOffs = await prisma.callOff.findMany({
    where: { ticketId: TICKET, callOffNo: { in: [3, 4] } },
    select: { id: true, callOffNo: true, lines: { select: { ticketLineId: true, description: true, requestedQty: true } } },
  });
  const co = new Map(callOffs.map((c) => [c.callOffNo, c]));

  // existing DNs must be clear (we deleted them earlier)
  const existing = await prisma.deliveryNote.count({ where: { ticketId: TICKET } });
  if (existing > 0) throw new Error(`Refusing: ${existing} delivery notes already exist on ticket`);

  const resolve = (callOffNo, token) => {
    const matches = co.get(callOffNo).lines.filter((l) => l.description.includes(token));
    if (matches.length !== 1) throw new Error(`token "${token}" matched ${matches.length} lines on call-off ${callOffNo}`);
    return matches[0].ticketLineId;
  };

  // Build DN3 from call-off 2 lines (delivered in full)
  const DN3 = {
    callOffNo: 4, date: "2026-06-20", signedBy: null,
    rawLines: co.get(4).lines.map((l) => ({
      ticketLineId: l.ticketLineId, qtyDelivered: Number(l.requestedQty), qtyBackOrder: 0, status: "DELIVERED",
    })),
  };

  const buildLines = (dn) =>
    dn.rawLines ?? dn.lines.map(([token, d, bo, status]) => ({
      ticketLineId: resolve(dn.callOffNo, token), qtyDelivered: d, qtyBackOrder: bo, status,
    }));

  const order = [DN1, DN2, DN3, DN4]; // -> deliveryNo 1,2,3,4
  for (const dn of order) {
    const lines = buildLines(dn);
    const callOffId = co.get(dn.callOffNo).id;
    const last = await prisma.deliveryNote.findFirst({ where: { ticketId: TICKET }, orderBy: { deliveryNo: "desc" }, select: { deliveryNo: true } });
    const deliveryNo = (last?.deliveryNo ?? 0) + 1;
    const created = await prisma.deliveryNote.create({
      data: {
        ticketId: TICKET, callOffId, deliveryNo, deliveryDate: new Date(dn.date),
        signedBy: dn.signedBy ?? undefined,
        lines: { create: lines },
      },
      include: { lines: true },
    });
    const total = created.lines.reduce((s, l) => s + Number(l.qtyDelivered), 0);
    console.log(`DN${deliveryNo}  call-off #${dn.callOffNo}  ${dn.date}  ${created.lines.length} lines  delivered=${total}`);
  }

  // Recompute call-off status from delivered totals (mirrors the API route)
  for (const callOffNo of [3, 4]) {
    const c = co.get(callOffNo);
    const agg = await prisma.deliveryNoteLine.groupBy({
      by: ["ticketLineId"], where: { deliveryNote: { callOffId: c.id } }, _sum: { qtyDelivered: true },
    });
    const got = new Map(agg.map((g) => [g.ticketLineId, Number(g._sum.qtyDelivered ?? 0)]));
    const allDelivered = c.lines.every((l) => (got.get(l.ticketLineId) ?? 0) >= Number(l.requestedQty) - 1e-6);
    const anyDelivered = c.lines.some((l) => (got.get(l.ticketLineId) ?? 0) > 0);
    const next = allDelivered ? "DELIVERED" : anyDelivered ? "PARTIALLY_DELIVERED" : "OPEN";
    await prisma.callOff.update({ where: { id: c.id }, data: { status: next } });
    const delivered = c.lines.reduce((s, l) => s + (got.get(l.ticketLineId) ?? 0), 0);
    const requested = c.lines.reduce((s, l) => s + Number(l.requestedQty), 0);
    console.log(`Call-off #${callOffNo}: status=${next}  delivered ${delivered}/${requested}`);
  }
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
