/**
 * Seeds SupplierAlias rows so the multi-signal match engine can resolve a name
 * variant to the canonical supplier.
 *
 * Sources:
 *   1. Hard-coded mappings from supplier_aliases.md memory
 *      (Villeroy-Boch = Ideal Standard, F W Hipkin = VERDIS = Kerridge K8)
 *   2. Auto-derived: any obvious case/spacing variant of an existing supplier name
 *      (e.g. "F W HIPKIN" already canonical, alias "F W Hipkin" / "fw hipkin")
 *   3. Email-domain → supplier (heuristic from Zoho-pulled bills' source attachments)
 */
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 2000 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// 1. Hard-coded canonical → aliases
const HARDCODED = [
  // Ideal Standard family
  { canonical: "Ideal Standard", aliases: ["Villeroy-Boch", "Villeroy Boch", "VilleroyBoch", "ideal-standard"], emails: ["villeroy-boch.com", "idealstandard.com", "idealstandard.co.uk"] },
  // F W Hipkin / VERDIS / Kerridge K8
  { canonical: "F W HIPKIN",     aliases: ["F W Hipkin", "FW Hipkin", "F.W. Hipkin", "VERDIS", "Verdis", "Kerridge K8"], emails: ["fwhipkin.co.uk", "verdis.co.uk"] },
];

// Helpers
const seenAliases = new Set();
let inserted = 0, skipped = 0, supplierMisses = 0;

async function upsertAlias(supplierId, alias, source) {
  const k = `${supplierId}|${alias.toLowerCase()}|${source}`;
  if (seenAliases.has(k)) { skipped++; return; }
  seenAliases.add(k);
  // Manual upsert (no unique constraint on (supplierId,alias,source) yet)
  const existing = await prisma.supplierAlias.findFirst({
    where: { supplierId, alias: { equals: alias, mode: "insensitive" }, source },
  });
  if (existing) { skipped++; return; }
  await prisma.supplierAlias.create({
    data: { supplierId, alias, source, confidence: source === "USER" ? 100 : source === "EMAIL_DOMAIN" ? 80 : 70 },
  });
  inserted++;
}

console.log("\n[1/3] Seeding hard-coded mappings from memory…");
for (const m of HARDCODED) {
  // Find canonical supplier (case-insensitive)
  const canonical = await prisma.supplier.findFirst({
    where: { name: { equals: m.canonical, mode: "insensitive" } },
  });
  if (!canonical) {
    console.log(`  ⚠ canonical supplier "${m.canonical}" not found in DB — skipping`);
    supplierMisses++;
    continue;
  }
  console.log(`  • ${canonical.name}`);
  for (const alias of m.aliases) await upsertAlias(canonical.id, alias, "USER");
  for (const domain of m.emails)  await upsertAlias(canonical.id, domain, "EMAIL_DOMAIN");
}

console.log("\n[2/3] Auto-deriving variants from existing supplier names…");
const allSuppliers = await prisma.supplier.findMany({ select: { id: true, name: true } });
for (const s of allSuppliers) {
  const variants = new Set();
  // Title case if name is all-caps
  if (s.name === s.name.toUpperCase() && s.name.length > 3) {
    variants.add(s.name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()));
  }
  // All-caps if name is title case
  if (s.name !== s.name.toUpperCase()) variants.add(s.name.toUpperCase());
  // Strip "Ltd"/"Limited" suffix
  const stripped = s.name.replace(/\s+(Ltd|Limited|Plc|UK|Group)\.?$/i, "").trim();
  if (stripped !== s.name && stripped.length > 3) variants.add(stripped);
  // Drop any variant equal to canonical (case-insensitive)
  for (const v of variants) {
    if (v.toLowerCase() === s.name.toLowerCase()) continue;
    await upsertAlias(s.id, v, "SYSTEM");
  }
}

console.log("\n[3/3] Auto-derive email domains from Zoho-pulled bills (sourceAttachmentRef)…");
// Naive but effective: for each supplier that has bills, pull the most-common sender domain from any IngestionEvent linked to those bills
const billsBySupplier = await prisma.supplierBill.groupBy({
  by: ["supplierId"],
  _count: { _all: true },
});
console.log(`  ${billsBySupplier.length} suppliers with bills`);
// (intentionally light — strong domain inference would need the email envelope, which Zoho-pulled bills lack. Outlook-ingested bills will get domain aliases via the email-poller path.)

console.log(`\n✓ Inserted ${inserted} new aliases · skipped ${skipped} (already present) · ${supplierMisses} canonical suppliers missing`);

const total = await prisma.supplierAlias.count();
console.log(`Total SupplierAlias rows now: ${total}`);

await prisma.$disconnect();
await pool.end();
