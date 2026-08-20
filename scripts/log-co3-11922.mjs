import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// The call-off the user specified on PO 11922 — [distinctive token, qty]
const ITEMS = [
  ["15MM STRAIGHT COUPLER", 177],
  ["22MM STRAIGHT COUPLER", 177],
  ['15 x 1/2" STR MALE CONN', 100],
  ["22 X 15MM FITTING REDUCER", 88],
  ["22mm TEE - EQUAL", 80],
  ["15x15x22mm REDUCED END", 70],
  ["22x22x15mm REDUCED BRANCH", 200],
  ['22 x 3/4" STR MALE CONN', 100],
  ['15mm x 1/2" CP STRAIGHT SERVICE', 24],
  ["COMPRESSION BACKPLATE ELBOW", 50],
  ["THERMAL BALANCE VALVE", 24],
  ["22x15x22mm REDUCE END & BRANCH", 200],
  ["15mm 2-IN-1 EASIFIT", 30],
  ["22mm 2-IN-1 EASIFIT", 130],
];

async function main() {
  const po = await prisma.customerPO.findFirst({
    where: { poNo: "11922" },
    include: { lines: true },
  });
  if (!po) throw new Error("PO 11922 not found");

  const resolve = (token) => {
    const m = po.lines.filter((l) => l.description.toLowerCase().includes(token.toLowerCase()));
    if (m.length !== 1) throw new Error(`token "${token}" matched ${m.length} PO lines`);
    return m[0];
  };

  // Enforce the same rule the app does: requested <= remaining (ordered - prior called off)
  const priorByLine = new Map();
  const grouped = await prisma.callOffLine.groupBy({
    by: ["customerPOLineId"],
    where: { callOff: { customerPOId: po.id } },
    _sum: { requestedQty: true },
  });
  for (const g of grouped) priorByLine.set(g.customerPOLineId, Number(g._sum.requestedQty ?? 0));

  const lines = ITEMS.map(([token, qty], i) => {
    const pl = resolve(token);
    const remaining = Number(pl.qty ?? 0) - (priorByLine.get(pl.id) ?? 0);
    if (qty > remaining + 1e-6) throw new Error(`${pl.description}: qty ${qty} > remaining ${remaining}`);
    return {
      customerPOLineId: pl.id,
      ticketLineId: pl.ticketLineId,
      description: pl.description,
      requestedQty: qty,
      agreedUnitPrice: Number(pl.agreedUnitPrice ?? 0),
      displayOrder: i + 1,
    };
  });

  const callOff = await prisma.callOff.create({
    data: {
      customerPOId: po.id,
      ticketId: po.ticketId ?? undefined,
      callOffDate: new Date(),
      source: "Picker UI",
      status: "OPEN",
      lines: {
        create: lines.map((l) => ({
          customerPOLineId: l.customerPOLineId,
          ticketLineId: l.ticketLineId ?? undefined,
          description: l.description,
          requestedQty: l.requestedQty,
          invoicedQty: 0,
          agreedUnitPrice: l.agreedUnitPrice,
          displayOrder: l.displayOrder,
        })),
      },
    },
    select: { id: true, callOffNo: true },
  });

  const total = lines.reduce((s, l) => s + l.requestedQty * l.agreedUnitPrice, 0);
  console.log(`Created call-off #${callOff.callOffNo} — ${lines.length} lines, £${total.toFixed(2)}`);
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e.message); prisma.$disconnect(); process.exit(1); });
