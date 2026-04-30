import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 10000,
  allowExitOnIdle: true,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const tags = [
  // Financial
  { name: "BILL", label: "Bill", category: "FINANCIAL", routingHandler: "bill_parser", sortOrder: 10, description: "Supplier bill / invoice — fires bill parser, allocates to chosen ticket" },
  { name: "CREDIT_NOTE", label: "Credit Note", category: "FINANCIAL", routingHandler: "credit_note", sortOrder: 20, description: "Supplier credit note for returns or pricing adjustments" },
  { name: "STATEMENT", label: "Statement", category: "FINANCIAL", routingHandler: "statement", sortOrder: 30, description: "AP statement reconciliation" },
  { name: "REMITTANCE", label: "Remittance", category: "FINANCIAL", routingHandler: "remittance", sortOrder: 40, description: "Customer remittance advice" },
  { name: "PAYMENT_RECEIVED", label: "Payment Received", category: "FINANCIAL", routingHandler: "payment", sortOrder: 50, description: "Payment confirmation from customer" },
  { name: "DISPUTE", label: "Dispute", category: "FINANCIAL", routingHandler: "dispute", sortOrder: 60, description: "Pricing or invoice dispute" },

  // Operational
  { name: "QUOTE_REQUEST", label: "Quote Request", category: "OPERATIONAL", routingHandler: "quote_request", sortOrder: 110, description: "Customer asking for a price" },
  { name: "QUOTE_RESPONSE", label: "Quote Response", category: "OPERATIONAL", routingHandler: "quote_response", sortOrder: 120, description: "Supplier quote on a request" },
  { name: "ORDER", label: "Order", category: "OPERATIONAL", routingHandler: "order", sortOrder: 130, description: "Customer order — confirmed go-ahead" },
  { name: "ORDER_ACK", label: "Order Ack", category: "OPERATIONAL", routingHandler: "order_ack", sortOrder: 140, description: "Supplier order acknowledgement" },
  { name: "DELIVERY_UPDATE", label: "Delivery Update", category: "OPERATIONAL", routingHandler: "delivery_update", sortOrder: 150, description: "ETA / delivery status / POD" },
  { name: "SITE_ISSUE", label: "Site Issue", category: "OPERATIONAL", routingHandler: "site_issue", sortOrder: 160, description: "Snag, complaint, or issue raised at site" },
  { name: "RETURN", label: "Return", category: "OPERATIONAL", routingHandler: "return", sortOrder: 170, description: "Return request or pickup" },
  { name: "SCHEDULE", label: "Schedule", category: "OPERATIONAL", routingHandler: "schedule", sortOrder: 180, description: "Site visit / delivery booking" },
  { name: "APPROVAL", label: "Approval", category: "OPERATIONAL", routingHandler: "approval", sortOrder: 190, description: "Customer approval / sign-off" },
  { name: "SPEC", label: "Spec", category: "OPERATIONAL", routingHandler: "spec", sortOrder: 200, description: "Spec or technical detail update" },
  { name: "COMPETITIVE_BID", label: "Competitive Bid", category: "OPERATIONAL", routingHandler: "competitive_bid", sortOrder: 210, description: "Competitor / market bid context" },

  // Both
  { name: "PO_RECEIVED", label: "PO Received", category: "BOTH", routingHandler: "po_received", sortOrder: 310, description: "Customer purchase order — financial commitment + operational trigger" },
  { name: "NOTE", label: "Note", category: "BOTH", routingHandler: "note", sortOrder: 900, description: "Generic comm — attach to ticket as a note, no automation" },
  { name: "NOISE", label: "Noise", category: "BOTH", routingHandler: "noise", sortOrder: 990, description: "Spam / marketing / not relevant — archive" },
];

async function main() {
  console.log("Seeding classification tags...\n");

  for (const tag of tags) {
    await prisma.classificationTag.upsert({
      where: { name: tag.name },
      create: tag as never,
      update: {
        label: tag.label,
        category: tag.category as never,
        routingHandler: tag.routingHandler,
        sortOrder: tag.sortOrder,
        description: tag.description,
      },
    });
    console.log(`  ${tag.name.padEnd(22)} — ${tag.category.padEnd(11)} → ${tag.routingHandler}`);
  }

  console.log("\nSeed complete.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
