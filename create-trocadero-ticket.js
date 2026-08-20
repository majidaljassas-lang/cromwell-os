const { PrismaClient } = require('./src/generated/prisma');

const prisma = new PrismaClient();

const items = [
  { description: 'A10 - McAlpine - Bottle Trap - 1.25"', qty: 1, unit: 'ea', cost: 4.16 },
  { description: 'Solvent Weld Waste Pipe 3m 32mm White', qty: 1, unit: 'ea', cost: 4.66 },
  { description: 'WS10W - FloPlast - 90* Bend ABS Solvent - White - 32mm', qty: 4, unit: 'ea', cost: 0.57 },
  { description: 'WS18W - FloPlast - 135* Bend ABS Solvent - White - 32mm', qty: 4, unit: 'ea', cost: 0.57 },
  { description: 'Waste Solvent Weld 32mm Pipe Clip White', qty: 3, unit: 'ea', cost: 0.34 },
  { description: 'PEM0215W Speedfit 15mm Tee (5)', qty: 4, unit: 'ea', cost: 2.47 },
  { description: '15mm x 25m PB Coil - White', qty: 1, unit: 'ea', cost: 18.89 },
  { description: 'KPELB15W - KeyPlumb PB Elbow - 15mm - White (10)', qty: 10, unit: 'ea', cost: 0.84 },
  { description: 'TS15 - Talon - Hinged Pipe Clips - 15mm', qty: 10, unit: 'ea', cost: 0.10 },
  { description: '15ESOT Speedfit 15mm Emergency Shut-Off Tap (5)', qty: 3, unit: 'ea', cost: 5.22 },
  { description: 'Compression Elbow 15mm', qty: 3, unit: 'ea', cost: 2.25 },
  { description: 'PEM0415W Speedfit 15mm Straight (10)', qty: 3, unit: 'ea', cost: 1.83 },
  { description: 'FLX17 - Flexi Tap Connector - Pushfit to Pushfit - 15mm x 15mm - 300mm', qty: 3, unit: 'ea', cost: 6.01 },
];

async function main() {
  try {
    // Find Criterion Developments customer
    const customer = await prisma.commercialEntity.findFirst({
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

    // Find Trocadero site (032 Troc Roof Ext)
    const site = await prisma.site.findFirst({
      where: {
        OR: [
          { siteName: { contains: 'Trocadero', mode: 'insensitive' } },
          { siteCode: { contains: '032', mode: 'insensitive' } },
          { aliases: { has: '032 Troc' } }
        ]
      }
    });

    if (!site) {
      throw new Error('Trocadero site not found');
    }

    // Create the ticket
    const ticket = await prisma.ticket.create({
      data: {
        title: '032 Troc Roof Ext - Plumbing order for welfare',
        description: 'Plumbing order for welfare',
        payingCustomerId: customer.id,
        siteId: site.id,
        ticketMode: 'DIRECT_ORDER',
        status: 'CAPTURED',
        createdAt: new Date(),
      }
    });

    console.log('✅ Ticket created:', ticket.id);

    // Create all line items
    let displayOrder = 0;
    for (const item of items) {
      const line = await prisma.ticketLine.create({
        data: {
          ticketId: ticket.id,
          displayOrder: displayOrder++,
          lineType: 'ITEM',
          description: item.description,
          qty: item.qty,
          unit: item.unit.toUpperCase(),
          payingCustomerId: customer.id,
          siteId: site.id,
          expectedCostUnit: item.cost,
          expectedCostTotal: item.qty * item.cost,
          status: 'CAPTURED'
        }
      });
      console.log(`  ✓ Line ${displayOrder}: ${item.description} (${item.qty} × £${item.cost.toFixed(2)})`);
    }

    console.log(`\n✅ Ticket complete: ${items.length} lines added`);
    console.log(`Ticket ID: ${ticket.id}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
