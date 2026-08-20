import "dotenv/config";
import { PrismaClient } from "./src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const items = [
  { description: 'A10 - McAlpine - Bottle Trap - 1.25"', qty: 1, unit: 'EA', cost: 4.16 },
  { description: 'Solvent Weld Waste Pipe 3m 32mm White', qty: 1, unit: 'EA', cost: 4.66 },
  { description: 'WS10W - FloPlast - 90* Bend ABS Solvent - White - 32mm', qty: 4, unit: 'EA', cost: 0.57 },
  { description: 'WS18W - FloPlast - 135* Bend ABS Solvent - White - 32mm', qty: 4, unit: 'EA', cost: 0.57 },
  { description: 'Waste Solvent Weld 32mm Pipe Clip White', qty: 3, unit: 'EA', cost: 0.34 },
  { description: 'PEM0215W Speedfit 15mm Tee (5)', qty: 4, unit: 'EA', cost: 2.47 },
  { description: '15mm x 25m PB Coil - White', qty: 1, unit: 'EA', cost: 18.89 },
  { description: 'KPELB15W - KeyPlumb PB Elbow - 15mm - White (10)', qty: 10, unit: 'EA', cost: 0.84 },
  { description: 'TS15 - Talon - Hinged Pipe Clips - 15mm', qty: 10, unit: 'EA', cost: 0.10 },
  { description: '15ESOT Speedfit 15mm Emergency Shut-Off Tap (5)', qty: 3, unit: 'EA', cost: 5.22 },
  { description: 'Compression Elbow 15mm', qty: 3, unit: 'EA', cost: 2.25 },
  { description: 'PEM0415W Speedfit 15mm Straight (10)', qty: 3, unit: 'EA', cost: 1.83 },
  { description: 'FLX17 - Flexi Tap Connector - Pushfit to Pushfit - 15mm x 15mm - 300mm', qty: 3, unit: 'EA', cost: 6.01 },
];

async function main() {
  try {
    // Find Criterion Developments customer
    const customer = await prisma.customer.findFirst({
      where: {
        name: {
          contains: 'Criterion',
          mode: 'insensitive'
        }
      }
    });

    if (!customer) {
      throw new Error('Criterion Developments customer not found');
    }

    console.log('Found customer:', customer.name);

    // Find Criterion HQ site
    const site = await prisma.site.findFirst({
      where: {
        siteName: {
          contains: 'Criterion',
          mode: 'insensitive'
        }
      }
    });

    if (!site) {
      throw new Error('Trocadero site not found');
    }

    console.log('Found site:', site.siteName);

    // Create the ticket
    const ticket = await prisma.ticket.create({
      data: {
        title: '032 Troc Roof Ext - Plumbing order for welfare',
        description: 'Plumbing order for welfare',
        payingCustomerId: customer.id,
        siteId: site.id,
        ticketMode: 'DIRECT_ORDER',
        status: 'CAPTURED',
      }
    });

    console.log('\n✅ Ticket created:', ticket.id);

    // Create all line items
    let displayOrder = 0;
    for (const item of items) {
      const costTotal = item.qty * item.cost;
      await prisma.ticketLine.create({
        data: {
          ticketId: ticket.id,
          displayOrder: displayOrder++,
          lineType: 'MATERIAL',
          description: item.description,
          qty: item.qty,
          unit: item.unit,
          payingCustomerId: customer.id,
          siteId: site.id,
          expectedCostUnit: item.cost,
          expectedCostTotal: costTotal,
          status: 'CAPTURED'
        }
      } as any);
      console.log(`  ✓ Line ${displayOrder}: ${item.description.substring(0, 50)}... (${item.qty} × £${item.cost.toFixed(2)})`);
    }

    const costTotals = items.reduce((acc, i) => acc + (i.qty * i.cost), 0);
    console.log(`\n✅ Ticket complete: ${items.length} lines added`);
    console.log(`📊 Total cost: £${costTotals.toFixed(2)}`);
    console.log(`🔗 Ticket ID: ${ticket.id}`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
