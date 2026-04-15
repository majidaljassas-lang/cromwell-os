import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { config } from "dotenv"; config({ path: ".env" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 2000 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const t = await prisma.ticket.findFirst({
  where: { id: { startsWith: "99f07784" } },
  select: { id: true, ticketNo: true, title: true, status: true, payingCustomerId: true, siteId: true,
    payingCustomer: { select: { name: true } },
    site: { select: { siteName: true, postcode: true } },
  },
});
console.log("Ticket:", t);
if (t?.payingCustomerId) {
  const contacts = await prisma.contact.findMany({
    where: { siteContactLinks: { some: { customerId: t.payingCustomerId, isActive: true } } },
    select: { id: true, fullName: true, email: true, phone: true },
  });
  console.log(`\nContacts linked to customer ${t.payingCustomer?.name}:`);
  for (const c of contacts) console.log(`  ${c.fullName.padEnd(25)} email=${c.email ?? "—"}  phone=${c.phone ?? "—"}`);
  const otherOpenTickets = await prisma.ticket.count({
    where: { payingCustomerId: t.payingCustomerId, status: { notIn: ["CLOSED","INVOICED","LOCKED"] } },
  });
  console.log(`\nOpen tickets for this customer: ${otherOpenTickets} (single-open is required for HIGH auto-link)`);
}
// Find inbox threads that mention Ferry Lane or 760mm
const suspects = await prisma.inboxThread.findMany({
  where: {
    OR: [
      { subject:     { contains: "Ferry Lane", mode: "insensitive" } },
      { subject:     { contains: "760",        mode: "insensitive" } },
      { lastSnippet: { contains: "Ferry Lane", mode: "insensitive" } },
      { lastSnippet: { contains: "760",        mode: "insensitive" } },
    ],
  },
  select: { id: true, subject: true, status: true, classification: true, participants: true, linkedTicketId: true, linkConfidence: true, linkSource: true },
  take: 10,
});
console.log(`\nCandidate threads (Ferry Lane / 760):`);
for (const s of suspects) console.log(`  [${s.status}/${s.linkConfidence ?? "—"}] ${s.subject?.slice(0,70)} · participants=${(s.participants ?? []).slice(0,2).join(",")} · linked=${s.linkedTicketId ?? "—"}`);
await prisma.$disconnect(); await pool.end();
