import { prisma } from "../src/lib/prisma";
import { Prisma } from "../src/generated/prisma";

const CUSTOMER_ID = "5c565016-5edf-4aa6-a6d7-9eea582c4d87"; // Fuseflow LTD
const SITE_ID = "50c52f14-ce4d-48fb-a422-2e1ad434950b"; // 60 Picadilly
const SCL_ID = "afb4f38c-8fa5-48b0-b736-af965dfc5f41";

type L = { d: string; u: "EA" | "LENGTH"; q: number; p: number };

const lines: L[] = [
  { d: "Copper Tube 28mm (3 Metre Length)", u: "LENGTH", q: 25, p: 26.82 },
  { d: "Copper Tube 22mm (3 Metre Length)", u: "LENGTH", q: 20, p: 20.79 },
  { d: "Copper Tube 15mm (3 Metre Length)", u: "LENGTH", q: 50, p: 10.40 },
  { d: "Pressfit Coupler - 28mm", u: "EA", q: 20, p: 1.92 },
  { d: "Pressfit Equal Tee - 28mm", u: "EA", q: 10, p: 4.43 },
  { d: "Pressfit Fitting Reducer - 28mm x 22mm", u: "EA", q: 20, p: 1.35 },
  { d: "Pressfit 90 Deg. Bend - 28mm", u: "EA", q: 25, p: 2.86 },
  { d: "Pressfit Coupler - 22mm", u: "EA", q: 10, p: 1.06 },
  { d: "Pressfit 90 Deg. Bend - 22mm", u: "EA", q: 20, p: 1.66 },
  { d: "Pressfit 45 Deg. Bend - 22mm", u: "EA", q: 10, p: 1.51 },
  { d: "Pressfit Equal Tee - 22mm", u: "EA", q: 20, p: 2.67 },
  { d: "Pressfit Fitting Reducer - 22mm x 15mm", u: "EA", q: 20, p: 0.86 },
  { d: "Pressfit 90 Deg. Bend - 15mm", u: "EA", q: 30, p: 0.95 },
  { d: "Pressfit Male Iron Coupler - 15mm x 1/2\"", u: "EA", q: 50, p: 1.58 },
  { d: "Pressfit Coupler - 15mm", u: "EA", q: 30, p: 0.72 },
  { d: "Pressfit End Cap - 15mm", u: "EA", q: 10, p: 0.73 },
  { d: "Pressfit Equal Tee - 15mm", u: "EA", q: 20, p: 1.63 },
  { d: "Press Lever Ball Valve Red/Blue Handle - 15mm", u: "EA", q: 25, p: 2.80 },
  { d: "Lever Ball Valve Red/Blue Handle - 22mm", u: "EA", q: 20, p: 4.00 },
  { d: "100mm Glycerine Filled Pressure Gauge", u: "EA", q: 6, p: 120.00 },
  { d: "WS03W - FloPlast - ABS Waste Pipe - White - 3m x 50mm", u: "LENGTH", q: 10, p: 10.00 },
  { d: "WS01W - FloPlast - ABS Waste Pipe - White - 3m x 32mm (10)", u: "LENGTH", q: 10, p: 5.70 },
  { d: "WS24W - FloPlast - Tee ABS Solvent - White - 50mm", u: "EA", q: 25, p: 2.10 },
  { d: "WS10W - FloPlast - 90° Bend ABS Solvent - White - 32mm", u: "EA", q: 30, p: 0.70 },
  { d: "WS12W - FloPlast - 90° Bend ABS Solvent - White - 50mm", u: "EA", q: 10, p: 1.85 },
  { d: "WS39W - FloPlast - ABS Reducer - White - 50mm x 32mm", u: "EA", q: 20, p: 1.20 },
  { d: "WS08W - FloPlast - Straight Coupling ABS Solvent - White - 40mm", u: "EA", q: 5, p: 0.70 },
  { d: "WS11W - FloPlast - 90° Bend ABS Solvent - White - 40mm", u: "EA", q: 5, p: 0.70 },
];

async function main() {
  const ticket = await prisma.ticket.create({
    data: {
      payingCustomerId: CUSTOMER_ID,
      siteId: SITE_ID,
      siteCommercialLinkId: SCL_ID,
      title: "60 Piccadilly — material list (FF-NJ-15-04-2026)",
      description: "Project 0067 — material list plumbing, ref FF-NJ-15-04-2026. Prices are client sale prices.",
      ticketMode: "DIRECT_ORDER",
      status: "CAPTURED",
      source: "WHATSAPP",
      lines: {
        create: lines.map((l, i) => {
          const total = +(l.q * l.p).toFixed(2);
          return {
            displayOrder: i + 1,
            lineType: "MATERIAL" as const,
            description: l.d,
            qty: new Prisma.Decimal(l.q),
            unit: l.u,
            payingCustomerId: CUSTOMER_ID,
            siteId: SITE_ID,
            siteCommercialLinkId: SCL_ID,
            suggestedSaleUnit: new Prisma.Decimal(l.p),
            actualSaleUnit: new Prisma.Decimal(l.p),
            actualSaleTotal: new Prisma.Decimal(total),
            status: "CAPTURED" as const,
          };
        }),
      },
    },
    select: { id: true, ticketNo: true, _count: { select: { lines: true } } },
  });

  const total = lines.reduce((s, l) => s + l.q * l.p, 0);
  console.log(JSON.stringify({
    ok: true,
    ticketId: ticket.id,
    ticketNo: `CP-${String(ticket.ticketNo).padStart(4, "0")}`,
    linesCreated: ticket._count.lines,
    salesTotalExVat: +total.toFixed(2),
  }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
