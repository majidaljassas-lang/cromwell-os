import { extractRfqCandidates } from "../src/lib/ingestion/rfq-parser";
const out = extractRfqCandidates("20x elbow 90x 22mm M/F 50x elbow 90x15mm press");
console.log(JSON.stringify(out, null, 2));
