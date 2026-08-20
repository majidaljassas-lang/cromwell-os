import { extractRfqCandidates } from "../src/lib/ingestion/rfq-parser";

const SOURCE = `Subject: You have a bid request from A C UK Group Ltd waiting for response
From: acukgroupltd@buildertrend.com <acukgroupltd@buildertrend.com>
Date: 2026-04-29T15:00:06Z

A C UK Group Ltd is Requesting your Bid on the Plant Room materials for C68 - Lexham Walk Job: C68 - Lexham Walk Title: Plant Room materials Bid Deadline: None set Notes From Builder: You are invited to submit a bid for your trade work as a Trade Partner on this construction project. Bid Request Description: Hi please quote for the following. 2x drain off valve 15mm compression 4x LBV valve 28mm press 1x AQUABION limescale converter 28mm 1x double check valve 28mm compression 2x tee 28x15x28mm press 2x drain cock 15mm 2x tee 28x28x28mm press 2x tee 28x22x28mm press 4x LBV 22mm press 4x LBV 15mm press 1x bush reduced 2"M x 1" F 1x elbow 1" x 28mm male iron 2x length 28mm cooper pipe 10x length 22mm cooper pipe 1x stop cock 22mm 1x secondary return pump 1x set GATE TYPE PUMP VALVE BRASS 22MM Compression 6x female elbow 1/2" x 15mm press 2x female elbow 1/2" x 22mm press 2x elbow 1/2" x 1/2" F brass 1x PRV 28mm 1x 1/2" M drain cock 30x elbow 90x22mm press 20x elbow 90x 22mm M/F 50x elbow 90x15mm press 20x elbow 90x15mm press M/F 4x length 40mm solvent pipe white 10x swept elbow 90x40mm solvent white 10x elbow 90 x 40mm solvent white M/F 10x elbow 45x40mm M/F solvent white 1x AAV 50 ( 2" ) solvent white 1x 110mm pipe solvent 4x AAV 110mm (4") 10x reduced 22x15mm press Thanks Dumitru Attachments: 2 Attachments Login View &amp; Submit Bid ** This email has been auto-generated on behalf of A C UK Group Ltd, please do not reply directly to this email ** © 2026 Buildertrend Solutions, Inc.

Created from inbox email thread: "You have a bid request from A C UK Group Ltd waiting for response"`;

const out = extractRfqCandidates(SOURCE);
console.log(`Extracted ${out.length} candidates:\n`);
for (const c of out) {
  const qty = c.qty != null ? String(c.qty).padStart(4) : "   ?";
  console.log(`${qty}  ${c.product}`);
}
