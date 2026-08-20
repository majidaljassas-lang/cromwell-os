#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Per Lusso PDFs: cost = cheaper quote (£2,300), sale = expensive quote (£2,462)
// Order = PDF order. Each entry maps (current line id) → target {displayOrder, productCode, qty, cost, sale}.
const updates = [
  { id: "8222109a-8d60-400d-b346-d331c6340e28", description: "Luxe Deep Bronze Toilet Roll Holder",                       productCode: "M225-1DB",                       qty: 1,  cost: 58.33,   sale: 60.96,   displayOrder: 1 },
  { id: "4d6156a9-20a7-4a02-ac4b-9db91ce01685", description: "Perlato Carrara Marble Countertop Basin 400mm",             productCode: "PTO40CAR",                       qty: 1,  cost: 366.67,  sale: 393.46,  displayOrder: 2 },
  { id: "eb7446f5-c25b-494d-89ce-73da3d0af2ca", description: "DC - Carrara Marble Waste Kit",                             productCode: "MARBLE_WASTE_SPOT_CARRARA",      qty: 1,  cost: 41.67,   sale: 43.54,   displayOrder: 3 },
  { id: "5a78873a-6b41-41c5-bd4c-54e180fc3c81", description: "Luxe Wall Mounted Basin Mixer Tap Deep Bronze",             productCode: "703-1DB",                        qty: 1,  cost: 208.33,  sale: 235.13,  displayOrder: 4 },
  { id: "0552bcea-ce31-4320-9f71-4c4cfcc8145c", description: "Luxe Deep Bronze Slotted Click Clack Basin Waste",          productCode: "S03DB",                          qty: 1,  cost: 41.67,   sale: 45.13,   displayOrder: 5 },
  { id: "f9c72a73-e234-4db8-907a-c89f4b6bb0c6", description: "Luxe Deep Bronze Round Bottle Trap",                        productCode: "P33DB",                          qty: 1,  cost: 66.67,   sale: 68.88,   displayOrder: 6 },
  { id: "2f9cfb9b-ea5b-4c80-84ae-787885936363", description: "DC - Lomazzo Carrara Marble Countertop Vanity Unit 800mm", productCode: "LOM800CAR+LOM800B",              qty: 1,  cost: 366.67,  sale: 387.92,  displayOrder: 7 },
  { id: "1059538b-d1bc-4b3d-a174-f9411074c04b", description: "Romano Fluted Carrara Marble Mosaic Wall Tile",             productCode: "ROM045CAR",                      qty: 10, cost: 73.333,  sale: 78.375,  displayOrder: 8 },
  { id: "7c4e4096-1b81-4c1d-bce9-7945c5584d17", description: "Delivery",                                                  productCode: null,                              qty: 1,  cost: 33.33,   sale: 33.33,   displayOrder: 9 },
];

async function main() {
  for (const u of updates) {
    const expectedCostTotal = +(u.cost * u.qty).toFixed(2);
    const actualSaleTotal   = +(u.sale * u.qty).toFixed(2);
    const margin            = +((u.sale - u.cost) * u.qty).toFixed(2);
    await prisma.ticketLine.update({
      where: { id: u.id },
      data: {
        displayOrder:        u.displayOrder,
        description:         u.description,
        productCode:         u.productCode,
        qty:                 u.qty,
        expectedCostUnit:    u.cost,
        expectedCostTotal,
        suggestedSaleUnit:   u.sale,
        actualSaleUnit:      u.sale,
        actualSaleTotal,
        expectedMarginTotal: margin,
        actualMarginTotal:   margin,
      },
    });
    console.log(`[${u.displayOrder}] ${u.description.slice(0,55)} | cost=${u.cost} sale=${u.sale} margin=${margin}`);
  }
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
