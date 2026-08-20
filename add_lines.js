const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const items = [
  { code: 'K22361', description: 'FiqPlast 90° Bend ABS Solvent - White - 40m', qty: 2, price: 2.04 },
  { code: 'K22483', description: 'FiqPlast 45° Tee - White - 40m', qty: 2, price: 2.55 },
  { code: 'K22823', description: 'FiqPlast Double Socket - 40m', qty: 7, price: 3.89 },
  { code: 'K22997', description: 'FiqPlast 92.5° Single Socket', qty: 1, price: 21.20 },
  { code: 'K23940', description: 'FiqPlast Boss Pipe', qty: 1, price: 25.85 },
  { code: 'K23175', description: 'FiqPlast 92.5° Branch', qty: 6, price: 38.78 },
  { code: 'K23327', description: 'FiqPlast Soil Pipe', qty: 4, price: 63.99 },
  { code: 'K11723', description: 'Keyflumb 15mm x 25m', qty: 1, price: 18.89 },
  { code: 'K21782', description: 'Keyflumb 15mm Metal Insert', qty: 50, price: 0.13 },
  { code: 'K22078', description: 'KeyPlumb PB Elbow - 15mm', qty: 10, price: 0.84 },
  { code: 'K22080', description: 'KeyPlumb PB Equal Tee - 15mm', qty: 10, price: 1.33 },
  { code: '83854', description: 'Makita 18V LXT Inflator', qty: 1, price: 65.99 },
];

async function run() {
  try {
    const ticketId = 'de80583b-6cc5-4d2e-963e-f728fb074298';
    const fusflowId = '5c565016-5edf-4aa6-a6d7-9eea582c4d87';

    console.log('Adding line items...');
    for (const item of items) {
      const line = await prisma.ticketLine.create({
        data: {
          ticketId,
          description: item.description,
          qty: item.qty,
          unit: 'EA',
          lineType: 'PRODUCT',
          payingCustomerId: fusflowId,
          productCode: item.code,
          expectedCostUnit: item.price,
          expectedCostTotal: item.qty * item.price,
          status: 'CAPTURED',
        },
      });
      console.log(`  ✓ ${item.description} (qty: ${item.qty})`);
    }

    console.log('\n✓ Done!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

run();
