/**
 * Seed the reconciliation for CP-0085 (Fuseflow LTD · Nour · 65 Piccadilly).
 *
 * Customer sent a revised 58-line list via purchasing@fuseflow.uk on
 * 2026-04-22 00:04 BST. They used the old Valsir codes for HDPE but verbally
 * confirmed they want Geberit-branded stock — we swap VS→Geberit on apply.
 *
 * Usage: npx tsx scripts/seed-cp0085-reconciliation.ts
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { createReconciliation } from "../src/lib/reconciliations/create";
import type { CustomerListRow } from "../src/lib/reconciliations/classify";

const PARENT_TICKET_ID = "0dee053d-a88b-4c59-ab7b-b3788e13751f"; // CP-0085

const CUSTOMER_LIST: CustomerListRow[] = [
  { idx: 1,  description: "Geberit HDPE - Ring Seal Adaptor with Cap - D.56", codeGiven: "VS0324004", qty: 55,  unit: "EA" },
  { idx: 2,  description: "Geberit HDPE - 88° Equal Branch - D.110/110",     codeGiven: "VS0312013", qty: 55,  unit: "EA" },
  { idx: 3,  description: "Geberit HDPE - 88° 4-Way Boss Branch - D.110/56", codeGiven: "VS0310994", qty: 55,  unit: "EA" },
  { idx: 4,  description: "Geberit HDPE - 45° Equal Branch - D.110",         codeGiven: "VS0309013", qty: 6,   unit: "EA" },
  { idx: 5,  description: "Geberit HDPE - 90° Access Pipe with Screw Cap - D.110", codeGiven: "VS0348011", qty: 48, unit: "EA" },
  { idx: 6,  description: "Geberit HDPE - Expansion Socket with Cap - D.110", codeGiven: "VS0328012", qty: 20,  unit: "EA" },
  { idx: 7,  description: "Geberit HDPE Pipe - D.110 - L.5m",                codeGiven: "VS0300013", qty: 47,  unit: "EA" },
  { idx: 8,  description: "Geberit HDPE - 45° Bend - D.110",                 codeGiven: "VS0306013", qty: 100, unit: "EA" },
  { idx: 9,  description: "Geberit HDPE - Electro Weld Coupler - D.110",     codeGiven: "VS0350011", qty: 206, unit: "EA" },
  { idx: 10, description: "FloPlast - 50mm × 92.5° Abs Swept Tee White",     codeGiven: "WS56W",     qty: 50,  unit: "EA" },
  { idx: 11, description: "FloPlast - 92.5° Bend ABS Solvent - White - 50mm", codeGiven: "WS16W",    qty: 25,  unit: "EA" },
  { idx: 12, description: "FloPlast - ABS Reducer - White - 50mm × 40mm",    codeGiven: "WS40W",     qty: 50,  unit: "EA" },
  { idx: 13, description: "FloPlast - Access Plug ABS Solvent - White - 40mm", codeGiven: "WS31W",   qty: 25,  unit: "EA" },
  { idx: 14, description: "Geberit Mapress St/St 316 Tube - 76×2mm - 6m",    codeGiven: "39009",     qty: 6,   unit: "EA" },
  { idx: 15, description: "Geberit Mapress St/St 316 Tube - 54×1.5mm - 6m",  codeGiven: "39008",     qty: 3,   unit: "EA" },
  { idx: 16, description: "Mapress St/St T-Piece Reduced (76 Tee + 76×54 Reducer)", codeGiven: "31233 / 31009 / 32331", qty: 2, unit: "EA" },
  { idx: 17, description: "15mm × 3M Copper Tube (EN1057 Black/Table X)",    codeGiven: null, qty: 200, unit: "LENGTH" },
  { idx: 18, description: "22mm × 3M Copper Tube",                           codeGiven: null, qty: 50,  unit: "LENGTH" },
  { idx: 19, description: "28mm × 3M Copper Tube",                           codeGiven: null, qty: 50,  unit: "LENGTH" },
  { idx: 20, description: "35mm × 3M Copper Tube",                           codeGiven: null, qty: 50,  unit: "LENGTH" },
  { idx: 21, description: "42mm × 3M Copper Tube",                           codeGiven: null, qty: 20,  unit: "LENGTH" },
  { idx: 22, description: "54mm × 3M Copper Tube",                           codeGiven: null, qty: 20,  unit: "LENGTH" },
  { idx: 23, description: "Pressfit Coupler - 15mm",                          codeGiven: null, qty: 50,  unit: "EA" },
  { idx: 24, description: "Pressfit Coupler - 22mm",                          codeGiven: null, qty: 25,  unit: "EA" },
  { idx: 25, description: "Pressfit Coupler - 28mm",                          codeGiven: null, qty: 50,  unit: "EA" },
  { idx: 26, description: "Pressfit Coupler - 35mm",                          codeGiven: null, qty: 50,  unit: "EA" },
  { idx: 27, description: "Pressfit Coupler - 42mm",                          codeGiven: null, qty: 10,  unit: "EA" },
  { idx: 28, description: "Pressfit Coupler - 54mm",                          codeGiven: null, qty: 10,  unit: "EA" },
  { idx: 29, description: "Pressfit Fitting Reducer - 15mm × 22mm",           codeGiven: null, qty: 20,  unit: "EA" },
  { idx: 30, description: "Pressfit Fitting Reducer - 35mm × 28mm",           codeGiven: null, qty: 10,  unit: "EA" },
  { idx: 31, description: "Pressfit Fitting Reducer - 42mm × 35mm",           codeGiven: null, qty: 10,  unit: "EA" },
  { idx: 32, description: "Pressfit Fitting Reducer - 54mm × 42mm",           codeGiven: null, qty: 10,  unit: "EA" },
  { idx: 33, description: "Pressfit Red. Tee - 22×15×22mm (L/C/R)",           codeGiven: null, qty: 50,  unit: "EA" },
  { idx: 34, description: "Pressfit Red. Tee - 35×22×35mm (L/C/R)",           codeGiven: null, qty: 50,  unit: "EA" },
  { idx: 35, description: "Pressfit Red. Tee - 28×22×28mm (L/C/R)",           codeGiven: null, qty: 50,  unit: "EA" },
  { idx: 36, description: "Pressfit 90° Bend - 15mm",                         codeGiven: null, qty: 250, unit: "EA" },
  { idx: 37, description: "Pressfit 90° Bend - 22mm",                         codeGiven: null, qty: 20,  unit: "EA" },
  { idx: 38, description: "Pressfit 90° Bend - 28mm",                         codeGiven: null, qty: 50,  unit: "EA" },
  { idx: 39, description: "Pressfit 90° Bend - 35mm",                         codeGiven: null, qty: 20,  unit: "EA" },
  { idx: 40, description: "Pressfit 90° Bend - 42mm",                         codeGiven: null, qty: 20,  unit: "EA" },
  { idx: 41, description: "Pressfit 90° Bend - 54mm",                         codeGiven: null, qty: 20,  unit: "EA" },
  { idx: 42, description: "Pressfit Wall Plate Elbow - 15mm × 1/2\"",         codeGiven: null, qty: 200, unit: "EA" },
  { idx: 43, description: "Straight Isolation Valve - Chrome - 15mm (WRAS)",  codeGiven: null, qty: 200, unit: "EA" },
  { idx: 44, description: "Compression Straight Iso Valve - Light Pattern - C/P - 22mm", codeGiven: null, qty: 100, unit: "EA" },
  { idx: 45, description: "Thermostatic Mixing Valve (WRAS Approved) - 15mm", codeGiven: "TMV15",   qty: 50,  unit: "EA" },
  { idx: 46, description: "K-Flex Class O Self Seal - 15mm × 19mm - 2m",      codeGiven: null, qty: 39,  unit: "EA" },
  { idx: 47, description: "K-Flex Class O Self Seal - 22mm × 9mm - 2m",       codeGiven: null, qty: 68,  unit: "EA" },
  { idx: 48, description: "K-Flex Class O Self Seal - 28mm × 9mm - 2m",       codeGiven: null, qty: 49,  unit: "EA" },
  { idx: 49, description: "K-Flex Class O Self Seal - 35mm × 9mm - 2m",       codeGiven: null, qty: 38,  unit: "EA" },
  { idx: 50, description: "Talon - Hinged Pipe Clips - 15mm - 100 Pack",      codeGiven: "TS15",    qty: 1,   unit: "PACK" },
  { idx: 51, description: "Rubber Lined Clip - 26-30mm (20)",                  codeGiven: "MSTR28",  qty: 250, unit: "EA" },
  { idx: 52, description: "Rubber Lined Clip - 32-36mm (20)",                  codeGiven: "MSTR35",  qty: 100, unit: "EA" },
  { idx: 53, description: "Rubber Lined Clip - 53-58mm (20)",                  codeGiven: "MSTR54",  qty: 500, unit: "EA" },
  { idx: 54, description: "Rubber Lined Clip - 47-51mm (20)",                  codeGiven: "MSTR48",  qty: 100, unit: "EA" },
  { idx: 55, description: "Rubber Lined Clip - 60-64mm",                       codeGiven: "MSTR63",  qty: 25,  unit: "EA" },
  { idx: 56, description: "Rubber Lined Clips - 107-112mm",                    codeGiven: "MSTR110", qty: 250, unit: "EA" },
  { idx: 57, description: "Stud Rod Zinc Plated - M10 × 1m",                   codeGiven: "MISDM10", qty: 115, unit: "EA" },
  { idx: 58, description: "Female Backplate for Rubber Lined Clips",           codeGiven: "MSTR-FI", qty: 500, unit: "EA" },
];

async function main() {
  // If a prior draft exists, delete it so we can re-seed cleanly. Refuse to
  // touch a reconciliation that's past PENDING_CUSTOMER_CONFIRMATION.
  const existing = await prisma.reconciliation.findFirst({
    where: { parentTicketId: PARENT_TICKET_ID, type: "VALSIR_GEBERIT_SWAP" },
  });
  if (existing) {
    if (
      existing.workflowState !== "DRAFT" &&
      existing.workflowState !== "PENDING_CUSTOMER_CONFIRMATION"
    ) {
      console.log(
        `Reconciliation #${existing.reconciliationNo} is in state ${existing.workflowState} — refusing to delete. Skipping.`,
      );
      return;
    }
    console.log(
      `Deleting existing reconciliation #${existing.reconciliationNo} (state=${existing.workflowState}) to re-seed.`,
    );
    await prisma.reconciliation.delete({ where: { id: existing.id } });
  }

  const recon = await createReconciliation({
    parentTicketId: PARENT_TICKET_ID,
    title: "Customer revised list reconciliation — Valsir to Geberit HDPE swap",
    type: "VALSIR_GEBERIT_SWAP",
    notes:
      "Source: purchasing@fuseflow.uk email 2026-04-22 00:04 BST, subject '65 Picadilly plumbing material'. Customer requests final discounted price + stock availability before placing PO. Customer used Valsir codes but verbally confirmed they want Geberit HDPE.",
    customerList: CUSTOMER_LIST,
    initialState: "PENDING_CUSTOMER_CONFIRMATION",
  });

  console.log("\n=== Reconciliation created ===");
  console.log(`ID: ${recon.id}`);
  console.log(`Number: #${recon.reconciliationNo}`);
  console.log(`State: ${recon.workflowState}`);
  console.log(`\n=== Section counts ===`);
  console.log(recon.classification.counts);
  if (recon.classification.discrepancies.length > 0) {
    console.log(`\n=== Discrepancies (${recon.classification.discrepancies.length}) ===`);
    for (const d of recon.classification.discrepancies) console.log(`• ${d}`);
  } else {
    console.log("\n(no discrepancies — A+B = customer list size)");
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
