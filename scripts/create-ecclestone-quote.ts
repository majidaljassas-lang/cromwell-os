/**
 * Create Ecclestone Square quote for Criterion Developments (no site yet).
 * Run: npx tsx scripts/create-ecclestone-quote.ts
 */
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const CUSTOMER_ID = "a0910826-f73e-4b36-87d8-60187e2a0efb"; // Criterion Developments

type Line = { qty: number; unit: "EA" | "PACK" | "M" | "BOX"; description: string };

const lines: Line[] = [
  { qty: 45, unit: "M", description: "41 x 41 x 2.5mm x 3m Slotted Channel" },
  { qty: 20, unit: "BOX", description: "M10 No Spring Channel Nuts" },
  { qty: 750, unit: "EA", description: "M10 Hexagon Nuts - Bright Zinc Plated" },
  { qty: 125, unit: "M", description: "M10 BZP Studding - 3m" },
  { qty: 12, unit: "BOX", description: "Square Plates - M10 (Pk100)" },
  { qty: 350, unit: "EA", description: "Channel Bracket - 90 Degree - 4 Hole (86)" },
  { qty: 350, unit: "EA", description: "Channel End Cap - 40mm Black (41x41mm)" },
  { qty: 700, unit: "EA", description: "Channel End Cap - 20mm Black (41x21mm)" },
  { qty: 9, unit: "PACK", description: "Silicone Carbide Abrasive Open Mesh (10 Strips pack)" },
  { qty: 6, unit: "EA", description: "100gm Silicone Grease Lubricant Screw Top Jar" },
  { qty: 150, unit: "EA", description: "M10 F Back Plate" },
  { qty: 150, unit: "EA", description: "M10 M Back Plate" },
  { qty: 800, unit: "EA", description: "xM10x30 Lipped dropin anchors" },
  { qty: 6, unit: "BOX", description: "SPIT TAPCON 6mm x 60mm DOME ANCHORS 1000 box" },
  { qty: 30, unit: "EA", description: "Bosch SDS Plus-5X Drill Bit 160 x 5.5mm" },
  { qty: 30, unit: "EA", description: "Bosch SDS Plus-5X Drill Bit 160 x 6.0mm" },
  { qty: 30, unit: "EA", description: "Bosch SDS Plus-5X Drill Bit 160 x 6.5mm" },
  { qty: 30, unit: "EA", description: "Bosch SDS Plus-5X Drill Bit 160 x 12mm" },
  { qty: 150, unit: "EA", description: "41/2\" 115mmx1.0mm flat ultra thin cutting discs" },
  { qty: 2, unit: "BOX", description: "5x50mm countersunk pozi drive woodscrew" },
  { qty: 2, unit: "BOX", description: "5x40mm countersunk pozi drive woodscrew" },
  { qty: 2, unit: "BOX", description: "4x40mm countersunk pozi drive woodscrew" },
  { qty: 2, unit: "BOX", description: "4x40mm countersunk pozi drive woodscrew" },
  { qty: 1750, unit: "EA", description: "rubber lined clips 110mm" },
  { qty: 70, unit: "EA", description: "rubber lined clips 63mm" },
  { qty: 10, unit: "EA", description: "rubber lined clips 90mm" },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const description = lines.map((l) => `${l.qty} x ${l.unit} - ${l.description}`).join("\n");

  const ticket = await prisma.ticket.create({
    data: {
      title: "Ecclestone Square - Criterion (New Job)",
      description,
      ticketMode: "PRICING_FIRST",
      status: "CAPTURED",
      payingCustomerId: CUSTOMER_ID,
      source: "MANUAL",
      lines: {
        create: lines.map((l, idx) => ({
          displayOrder: idx,
          lineType: "MATERIAL",
          description: l.description,
          qty: l.qty,
          unit: l.unit,
          payingCustomerId: CUSTOMER_ID,
          status: "CAPTURED",
        })),
      },
    },
    select: { id: true, ticketNo: true, title: true, status: true, ticketMode: true },
  });

  const count = await prisma.ticketLine.count({ where: { ticketId: ticket.id } });
  console.log(JSON.stringify({ ticket, lineCount: count }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
