#!/usr/bin/env node
import "dotenv/config";

const BASE = "http://localhost:3000";

const payload = {
  customerId: "970ca49f-4f5a-4308-9c9f-396c3054a251",
  ticketIds: [
    "4e1ddde9-7746-43a1-9ecb-becd8adc2a0e",
    "34f437b4-a689-4068-b279-fb13c53b4424",
  ],
  siteId: "2988269f-1583-4671-8283-5b127b642fa6",
  poNo: "352190583",
  poDate: "2026-08-07",
  issuedBy: "INGRID R.J MARTINS",
  fileRef: "/po-uploads/nhs-352190583.pdf",
  fileName: "NHS_PO_352190583.pdf",
  lines: [
    {
      qty: 10,
      productCode: "B4449Aa",
      description: "Sandringham Kitchen Mixer",
      unitPrice: 125,
      lineTotal: 1250,
    },
    {
      qty: 1,
      productCode: "A/KB50HF",
      description: "2-inch-high flow KB Aylesbury Float Type valve",
      unitPrice: 2291.76,
      lineTotal: 2291.76,
    },
    {
      qty: 100,
      productCode: "",
      description: "15mm x 3M Copper Tube to EN1057",
      unitPrice: 12,
      lineTotal: 1200,
    },
  ],
};

async function main() {
  console.log("📤 Uploading NHS PO 352190583 to cromwell-os...\n");

  try {
    const response = await fetch(`${BASE}/api/customer-pos/upload-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (response.ok) {
      console.log("✅ SUCCESS!\n");
      console.log("Response:", result);
      console.log("\n" + "=".repeat(70));
      console.log("\n📊 PO Created:");
      console.log(`  PO ID:          ${result.id}`);
      console.log(`  PO Number:      ${result.poNo}`);
      console.log(`  Linked Tickets: ${result.linkedTickets}`);
      console.log("\n" + "=".repeat(70));
    } else {
      console.log("❌ ERROR:", response.status, result);
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ Connection error:", err.message);
    console.error(
      "\nMake sure cromwell-os is running on http://localhost:3000"
    );
    process.exit(1);
  }
}

main();
