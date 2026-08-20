/**
 * Create "Haymarket Sundries" ticket for Criterion Developments at Haymarket site.
 * Run: npx tsx scripts/create-haymarket-sundries.ts
 */
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const CUSTOMER_ID = "a0910826-f73e-4b36-87d8-60187e2a0efb"; // Criterion Developments
const SITE_ID = "a5b5cb59-9e0a-4f70-9741-1bc3d8cb57c1"; // Haymarket — 28-29 Haymarket House - CDL
const SITE_LINK_ID = "df6fadf7-d0fa-438a-9b88-761481c7a6ab";

type Line = { qty: number; unit: "EA" | "PACK" | "M" | "ROLL"; description: string };

const lines: Line[] = [
  { qty: 300,  unit: "EA",   description: "15MM STOP END WHITE PUSH FIT DEMOUNTABLE" },
  { qty: 300,  unit: "EA",   description: "1/2\" construction plugs" },
  { qty: 5000, unit: "EA",   description: "4x40mm countersunk pozi drive woodscrews" },
  { qty: 5000, unit: "EA",   description: "5x40mm countersunk pozi drive woodscrews" },
  { qty: 5000, unit: "EA",   description: "5x50mm countersunk pozi drive woodscrews" },
  { qty: 5000, unit: "EA",   description: "6mm x 35mm wall plugs (red)" },
  { qty: 5000, unit: "EA",   description: "7mm x 35mm wall plugs (brown)" },
  { qty: 1000, unit: "EA",   description: "Spit tapcon concrete screws 6x60" },
  { qty: 200,  unit: "EA",   description: "Bosch SDS Plus Drill Bit 160 x 12mm" },
  { qty: 250,  unit: "EA",   description: "Bosch SDS Plus Drill Bit 160 x 5.5mm" },
  { qty: 250,  unit: "EA",   description: "Bosch SDS Plus Drill Bit 160 x 6.0mm" },
  { qty: 250,  unit: "EA",   description: "Bosch SDS Plus Drill Bit 160 x 6.5mm" },
  { qty: 200,  unit: "EA",   description: "Bosch SDS Plus Drill Bit 160 x 7.0mm" },
  { qty: 2000, unit: "EA",   description: "4 1/2\" 115mm x 1.0mm flat ultra thin cutting discs" },
  { qty: 10,   unit: "PACK", description: "Silicone Carbide Abrasive Open Mesh (10 Strips pack)" },
  { qty: 50,   unit: "EA",   description: "V-2 JETLUBE 300G" },
  { qty: 50,   unit: "EA",   description: "100gm Silicone Grease Lubricant Screw Top Jar" },
  { qty: 30,   unit: "EA",   description: "Fernox Solder Wire Lead-Free 500g" },
  { qty: 30,   unit: "EA",   description: "Fernox Powerflow Flux 350g" },
  { qty: 30,   unit: "EA",   description: "Rothenberger MAPP Disposable Gas Cylinder 400g" },
  { qty: 200,  unit: "EA",   description: "Loctite 55 Thread Seal cord" },
  { qty: 350,  unit: "EA",   description: "General Purpose Low Mod White" },
  { qty: 200,  unit: "PACK", description: "Talon Interlock Hinged Clip Spacer (Pack of 100)" },
  { qty: 100,  unit: "PACK", description: "15mm Talon Single Clip (Pack of 100)" },
  { qty: 100,  unit: "PACK", description: "22mm Talon Single Clip (Pack of 100)" },
  { qty: 2400, unit: "EA",   description: "Rubber lined clips 110mm (M10)" },
  { qty: 80,   unit: "EA",   description: "Rubber lined clips 63mm" },
  { qty: 10,   unit: "EA",   description: "Rubber lined clips 90mm" },
  { qty: 460,  unit: "EA",   description: "Rubber lined clips 160mm" },
  { qty: 6000, unit: "EA",   description: "22MM - 1/2\" (20-25mm) rubber lined clip" },
  { qty: 6000, unit: "EA",   description: "3/8\" (15-18mm) rubber lined clip" },
  { qty: 1040, unit: "EA",   description: "42MM - 1 1/4\" (42-44mm) rubber lined clip" },
  { qty: 500,  unit: "EA",   description: "52mm rubber lined clip" },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const description = lines.map((l) => `${l.qty} x ${l.description}`).join("\n");

  const ticket = await prisma.ticket.create({
    data: {
      title: "Haymarket Sundries",
      description,
      ticketMode: "PRICING_FIRST",
      status: "CAPTURED",
      payingCustomerId: CUSTOMER_ID,
      siteId: SITE_ID,
      siteCommercialLinkId: SITE_LINK_ID,
      source: "MANUAL",
      lines: {
        create: lines.map((l, idx) => ({
          displayOrder: idx,
          lineType: "MATERIAL",
          description: l.description,
          qty: l.qty,
          unit: l.unit,
          payingCustomerId: CUSTOMER_ID,
          siteId: SITE_ID,
          siteCommercialLinkId: SITE_LINK_ID,
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
