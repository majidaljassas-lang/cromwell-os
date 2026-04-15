// SURGICAL RECOVERY PASS — extract missed lines & create threads
// Dellow Centre — case 58ebd22e-1101-4d56-a672-7cf635be9339
//
// Usage:
//   node scripts/recovery-pass-extract.js --dry-run
//   node scripts/recovery-pass-extract.js          (writes)

const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";
const DRY_RUN = process.argv.includes("--dry-run");

// ---------- Task 1: missed sub-lines on mega-thread messages ----------
// For each thread we enumerate explicitly every sub-size line in the order.
// Existing lines on the same message will be skipped IF they already express
// the same product+qty+unit (fuzzy match). Otherwise we insert with status
// MESSAGE_LINKED so the matching pass can elevate to INVOICED.

// Message metadata
const MEGA = {
  be599813: {
    threadPrefix: "08ab6ac4",
    msgId: "be599813-eac6-422f-9bd4-855044749ae6",
    date: "2025-01-11T15:32:04.000Z",
    sender: "Adrian Koverok",
    lines: [
      // PIPE — all in black except 32 white
      { product: "PIPE 110mm black", qty: 20, unit: "EA", raw: "PIPE 110mm -20no (all in black)" },
      { product: "PIPE 50mm black",  qty: 20, unit: "EA", raw: "PIPE 50mm -20no (black)" },
      { product: "PIPE 40mm black",  qty: 10, unit: "EA", raw: "PIPE 40mm -10no (black)" },
      { product: "PIPE 32mm white",  qty: 5,  unit: "EA", raw: "PIPE 32mm -5no (white)" },
      // ELBOW 90
      { product: "ELBOW 90 110mm DOUBLE SOCKET push-fit", qty: 30, unit: "EA", raw: "ELBOW 90 110mm double socket push-fit -30no" },
      { product: "ELBOW 90 110mm SINGLE SOCKET push-fit", qty: 10, unit: "EA", raw: "ELBOW 90 110mm single socket push-fit -10no" },
      { product: "ELBOW 90 50mm sweep bend", qty: 50, unit: "EA", raw: "ELBOW 90 50mm sweep bends -50no" },
      { product: "ELBOW 90 40mm sweep bend", qty: 50, unit: "EA", raw: "ELBOW 90 40mm sweep bends -50no" },
      { product: "ELBOW 90 32mm sweep bend white", qty: 30, unit: "EA", raw: "ELBOW 90 32mm sweep bends white -30no" },
      // ELBOW 135
      { product: "ELBOW 135 110mm push-fit", qty: 30, unit: "EA", raw: "ELBOW 135 110mm push-fit -30no" },
      { product: "ELBOW 135 50mm", qty: 40, unit: "EA", raw: "ELBOW 135 50mm -40no" },
      { product: "ELBOW 135 40mm", qty: 20, unit: "EA", raw: "ELBOW 135 40mm -20no" },
      { product: "ELBOW 135 32mm white", qty: 20, unit: "EA", raw: "ELBOW 135 32mm white -20no" },
      // STRAIGHT COUPLING
      { product: "STRAIGHT COUPLING 110mm push-fit", qty: 20, unit: "EA", raw: "STRAIGHT COUPLING 110mm push-fit -20no" },
      { product: "STRAIGHT COUPLING 50mm", qty: 30, unit: "EA", raw: "STRAIGHT COUPLING 50mm -30no" },
      { product: "STRAIGHT COUPLING 40mm", qty: 10, unit: "EA", raw: "STRAIGHT COUPLING 40mm -10no" },
      { product: "STRAIGHT COUPLING 32mm", qty: 10, unit: "EA", raw: "STRAIGHT COUPLING 32mm -10no" },
      // REDUCER
      { product: "REDUCER 110x50mm", qty: 15, unit: "EA", raw: "REDUCER 110x50mm -15no" },
      { product: "REDUCER 50x40mm", qty: 30, unit: "EA", raw: "REDUCER 50x40mm -30no" },
      { product: "REDUCER 50x32mm", qty: 30, unit: "EA", raw: "REDUCER 50x32mm -30no" },
      // STOP END
      { product: "STOP END 110mm female", qty: 10, unit: "EA", raw: "STOP END 110mm female -10no" },
      { product: "STOP END 50mm female",  qty: 10, unit: "EA", raw: "STOP END 50mm female -10no" },
      { product: "STOP END 40mm female",  qty: 10, unit: "EA", raw: "STOP END 40mm female -10no" },
      // ADMITTANCE VALVE
      { product: "ADMITTANCE VALVE 110mm", qty: 10, unit: "EA", raw: "ADMITTANCE VALVE 110mm -10no" },
      { product: "ADMITTANCE VALVE 50mm",  qty: 10, unit: "EA", raw: "ADMITTANCE VALVE 50mm -10no" },
      // SHORT BOSS CONNECTOR
      { product: "SHORT BOSS CONNECTOR 110mm", qty: 20, unit: "EA", raw: "SHORT BOSS CONNECTOR 110mm -20no" },
      // PIPE CLIPS/BRACKETS
      { product: "PIPE CLIP/BRACKET 110mm", qty: 30, unit: "EA", raw: "PIPE CLIPS/BRACKETS 110mm -30no" },
      { product: "PIPE CLIP/BRACKET 50mm",  qty: 20, unit: "EA", raw: "PIPE CLIPS/BRACKETS 50mm -20no" },
      // 2 BOSS SINGLE SOCKET / ACCESS
      { product: "2 BOSS SINGLE SOCKET ACCESS 110mm", qty: 5, unit: "EA", raw: "2 BOSS SINGLE SOCKET / ACCESS (for rood dings) -5no" },
      // TEE JUNCTION
      { product: "TEE JUNCTION 110mm push-fit", qty: 1, unit: "EA", raw: "TEE JUNCTION 110mm (push-fit if possible, see picture)" },
      { product: "TEE JUNCTION 50mm", qty: 30, unit: "EA", raw: "TEE JUNCTION 50mm -30no" },
      { product: "TEE JUNCTION 40mm", qty: 10, unit: "EA", raw: "TEE JUNCTION 40mm -10no" },
      // FIRE COLLAR
      { product: "FIRE COLLAR 110mm", qty: 20, unit: "EA", raw: "FIRE COLLAR 110mm -20no" },
      { product: "FIRE COLLAR 50mm",  qty: 20, unit: "EA", raw: "FIRE COLLAR 50mm -20no" },
    ],
  },
  "4fe518b2": {
    threadPrefix: "a9c2cabb",
    msgId: "4fe518b2-0aa0-422b-97c3-b4c83149d265",
    date: "2025-01-03T15:27:39.000Z",
    sender: "Adrian Koverok",
    lines: [
      // END FEED Copper pipe (B = bundle, so these are bundles)
      { product: "END FEED Copper pipe 15mm", qty: 5, unit: "BUNDLE", raw: "END FEED Copper pipe 15mm -5/B" },
      { product: "END FEED Copper pipe 22mm", qty: 3, unit: "BUNDLE", raw: "END FEED Copper pipe 22mm -3/B" },
      { product: "END FEED Copper pipe 28mm", qty: 3, unit: "BUNDLE", raw: "END FEED Copper pipe 28mm -3/B" },
      // Equal TEE end feed copper
      { product: "END FEED Equal TEE 15mm", qty: 40, unit: "EA", raw: "Equal TEE 15mm -40no" },
      { product: "END FEED Equal TEE 22mm", qty: 40, unit: "EA", raw: "Equal TEE 22mm -40no" },
      { product: "END FEED Equal TEE 28mm", qty: 20, unit: "EA", raw: "Equal TEE 28mm -20no" },
      // REDUCED TEE
      { product: "END FEED Reduced TEE 22/15/22", qty: 20, unit: "EA", raw: "REDUCED TEE 22/15/22 -20no" },
      { product: "END FEED Reduced TEE 28/22/28", qty: 60, unit: "EA", raw: "REDUCED TEE 28/22/28 -60no" },
      // EQUALS ELBOW
      { product: "END FEED Equal Elbow 15mm", qty: 100, unit: "EA", raw: "EQUALS ELBOW 15mm -100no" },
      { product: "END FEED Equal Elbow 22mm", qty: 60,  unit: "EA", raw: "EQUALS ELBOW 22mm -60no" },
      { product: "END FEED Equal Elbow 28mm", qty: 20,  unit: "EA", raw: "EQUALS ELBOW 28mm -20no" },
      // EQUAL 90 Street Elbows
      { product: "END FEED Street Elbow 90 15mm", qty: 20, unit: "EA", raw: "EQUAL 90 Street Elbow 15mm -20no" },
      { product: "END FEED Street Elbow 90 22mm", qty: 30, unit: "EA", raw: "EQUAL 90 Street Elbow 22mm -30no" },
      { product: "END FEED Street Elbow 90 28mm", qty: 20, unit: "EA", raw: "EQUAL 90 Street Elbow 28mm -20no" },
      // STRAIGHT COUPLERS
      { product: "END FEED Straight Coupler 15mm", qty: 40, unit: "EA", raw: "STRAIGHT COUPLERS 15mm -40no" },
      { product: "END FEED Straight Coupler 22mm", qty: 20, unit: "EA", raw: "STRAIGHT COUPLERS 22mm -20no" },
      { product: "END FEED Straight Coupler 28mm", qty: 30, unit: "EA", raw: "STRAIGHT COUPLERS 28mm -30no" },
      // STRAIGHT REDUCERS F
      { product: "END FEED Straight Reducer F 22x15mm", qty: 30, unit: "EA", raw: "STRAIGHT REDUCERS F 22x15mm -30no" },
      { product: "END FEED Straight Reducer F 28x22mm", qty: 20, unit: "EA", raw: "STRAIGHT REDUCERS F 28x22mm -20no" },
      // VALVES
      { product: "Isolating Valve 15mm", qty: 100, unit: "EA", raw: "VALVE 15mm isolating valve -100no" },
      { product: "Full-open Ball Valve with handle 22mm", qty: 40, unit: "EA", raw: "VALVE 22mm with handle/full open -40no" },
      // Pipe Clips
      { product: "Pipe Clip 15mm", qty: 100, unit: "EA", raw: "Pipe Clip 15mm -100no" },
      { product: "Pipe Clip 22mm", qty: 100, unit: "EA", raw: "Pipe Clip 22mm -100no" },
      // Tesla rubber-lined (19-26 already present as MSTR19?; 26-31 already as MSTR28). Skip — duplicate risk.
      // Solvent cement — already present on message. Skip.
      // Pipe cleaner mesh
      { product: "Pipe cleaner mesh", qty: 3, unit: "PACK", raw: "Pipe cleaner (mesh) -2/3 packs" },
    ],
  },
  "16105344": {
    threadPrefix: "932025ac",
    msgId: "16105344-b48f-4800-814d-f674d84b3e16",
    date: "2025-01-09T09:01:33.000Z",
    sender: "Adrian Koverok",
    lines: [
      // PVA 20L
      { product: "PVA 20L", qty: 20, unit: "L", raw: "PVA -20L" },
      // Sandpaper
      { product: "Sandpaper G60 roll", qty: 2, unit: "ROLL", raw: "Sand paper G60 -2 rolls" },
      { product: "Sandpaper G80 roll", qty: 2, unit: "ROLL", raw: "Sand paper G80 -2 rolls" },
      { product: "Sandpaper G120 roll", qty: 3, unit: "ROLL", raw: "Sand paper G120 -3 rolls" },
      // Grinder discs
      { product: "Grinder disc 125mm", qty: 3, unit: "PACK", raw: "Grinders disk 125mm -3 pack" },
      { product: "Grinder disc 115mm", qty: 3, unit: "PACK", raw: "Grinders disk 115mm -3 pack" },
      // Transparent silicone (Clear)
      { product: "Silicone Transparent (clear)", qty: 30, unit: "EA", raw: "Silicone Transparent (clear) -30no" },
      // Extra screws
      { product: "Wood screws 5x70mm", qty: 300,  unit: "EA", raw: "Wood screws 5x70mm -300" },
      { product: "Wood screws 5x100mm", qty: 1000, unit: "EA", raw: "Wood screws 5x100mm -1000" },
      // Timber joists
      { product: "Timber joists 47x100x3000mm", qty: 50, unit: "L", raw: "Timber joists 47x100x3000mm -50L" },
      // Timber battens
      { product: "Timber battens 25x50mm", qty: 200, unit: "M", raw: "Timber battens 25x50mm -200m" },
      // Paslode nails
      { product: "Paslode nails second fix angle", qty: 1, unit: "EA", raw: "Paslode nails (second fix angle) — call Adrian before ordering" },
    ],
  },
  "b21bdec4": {
    threadPrefix: "d96a352c",
    msgId: "b21bdec4-435e-4a8f-a142-0b8f5abd1a51",
    date: "2025-02-10T12:35:52.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Hand wash basin RHS tap (as last order)", qty: 27, unit: "EA", raw: "27no Hand wash basin RHS tap as last order" },
      { product: "Bathroom tap (shower tap, as last order)", qty: 25, unit: "EA", raw: "25 bathroom taps as last order (shower tap)" },
      { product: "Toilets flush to wall", qty: 26, unit: "EA", raw: "26no Toilets flash to wall" },
      { product: "Cistern high level (as last order)", qty: 26, unit: "EA", raw: "26 cisterns same as last order the high level" },
      { product: "2m long flush pipe for the cistern", qty: 27, unit: "EA", raw: "27no 2m long flush pipe for the cistern" },
      { product: "90 degree flush pipe bend for toilet", qty: 85, unit: "EA", raw: "85no 90 degree for the toilet flush pipe" },
      { product: "Round stainless steel kitchen sink 450mm", qty: 27, unit: "EA", raw: "27no 450mm Kitchen round sink and waste (screwfix 5859k)" },
      { product: "Single lever mono mixer kitchen tap chrome", qty: 27, unit: "EA", raw: "27 kitchen tap single lever (screwfix 9192t)" },
    ],
  },
};

// ---------- Task 2: new threads ----------
const TASK2 = [
  {
    label: "[Recovery] Sanitary & Plumbing Fixtures — Catalyn 2025-03-31",
    description: "Shower trays, basins, toilets, cisterns, waste traps, shower doors, panels, taps, magnolia paint",
    msgId: "16105cd4-3ffe-4aaa-b15c-bf456443b5f3",
    date: "2025-03-31T14:58:32.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Shower tray 800x1600", qty: 4, unit: "EA", raw: "Shower tray – 4 units (800 x 1600)" },
      { product: "Hand wash basin (Victoria Plumb, as before)", qty: 6, unit: "EA", raw: "Hand wash basin – 6 units victoria plumbing ones same as before" },
      { product: "Toilet", qty: 5, unit: "EA", raw: "Toilet – 5 units" },
      { product: "Toilet cistern (same as previous 27no)", qty: 5, unit: "EA", raw: "Toilet cistern – 5 units same as the 27no previously ordered" },
      { product: "38mm waste trap white with air valve", qty: 1, unit: "EA", raw: "38mm waste trap (white with air valve)" },
      { product: "Shower door 800mm wide", qty: 5, unit: "EA", raw: "Shower doors – 5 units (800mm wide)" },
      { product: "PVC panel olive colour", qty: 20, unit: "EA", raw: "Panels olive colour – 20 units" },
      { product: "PVC corner", qty: 8, unit: "EA", raw: "Corners – 8 units" },
      { product: "PVC straight connector", qty: 10, unit: "EA", raw: "Straight connectors – 10 units" },
      { product: "Chrome trap 32mm", qty: 6, unit: "EA", raw: "Chrome trap – 6 units (32mm)" },
      { product: "Hand wash basin tap (Victoria Plumb, as before)", qty: 6, unit: "EA", raw: "Hand wash basin taps – 6 units Victoria plumbing ones same as previous order" },
      { product: "Caulk (Magnolia)", qty: 2, unit: "BOX", raw: "Caulk (Magnolia) – 2 boxes" },
      { product: "Magnolia wall paint", qty: 50, unit: "L", raw: "Magnolia wall paint – 50L" },
    ],
  },
  {
    label: "[Recovery] Electrician first-fix materials — Catalyn 2025-01-20",
    description: "Plasterbox, heat sensor, EM lights, LSZH cable, trunking, unistrut, threaded bolts, fire cable",
    msgId: "dae01271-c6ce-4d76-b895-6bd2e2fbf31b",
    date: "2025-01-20T16:08:31.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Plasterbox 2 gang", qty: 50, unit: "EA", raw: "50 pcs plasterbox 2gang" },
      { product: "Plasterbox 1 gang", qty: 50, unit: "EA", raw: "50 pcs plasterbox 1 gang" },
      { product: "Heat sensor", qty: 14, unit: "EA", raw: "14 pcs heat sensor" },
      { product: "Emergency lights (EM)", qty: 20, unit: "EA", raw: "20 pcs Emm lights (on site)" },
      { product: "LSZH cable 2x2.5+1.5", qty: 400, unit: "M", raw: "2x2,5 +1.5 lszh 400m" },
      { product: "LSZH cable 2x1.5+1", qty: 300, unit: "M", raw: "2x1.5 +1 lszh 300m" },
      { product: "Trunking 100x60", qty: 30, unit: "M", raw: "Trunking 100x60 ---30 m" },
      { product: "Unistrut 2.5", qty: 3, unit: "EA", raw: "Unistrat 2.5 -- 3 pcs" },
      { product: "Threaded bolt 10mm 4m", qty: 4, unit: "M", raw: "Threaded bolt 10mm 4m" },
      { product: "Fire cable 2 pair 1.5", qty: 200, unit: "M", raw: "Fire cable 2 pair 1.5 -200m" },
    ],
  },
  {
    label: "[Recovery] Cast Iron soil fittings — Adrian 2025-01-13",
    description: "Cast iron pipe 110mm, joint collar, tees, elbows, rubber brackets",
    msgId: "e06df122-8e3e-4450-a7a1-56b31710ed2c",
    date: "2025-01-13T17:44:49.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Cast Iron Pipe 110mm", qty: 10, unit: "EA", raw: "Cast Iron Pipe 110mm -10no" },
      { product: "Cast Iron Pipe joint collar 110mm", qty: 10, unit: "EA", raw: "Cast Iron Pipe joint collar -10no" },
      { product: "Cast Iron Equal tee 88 degree 110mm", qty: 7, unit: "EA", raw: "Cast Iron Equal tee 88* -7no" },
      { product: "Cast Iron Tee 45 degree 110mm", qty: 4, unit: "EA", raw: "Cast Iron Tee 45 degree -4no" },
      { product: "Cast Iron Elbow 90 degree 110mm", qty: 20, unit: "EA", raw: "Cast Iron Elbow 90* -20no" },
      { product: "Cast Iron Elbow 135 degree 110mm", qty: 10, unit: "EA", raw: "Cast Iron Elbow 135* -10no" },
      { product: "Cast Iron Rubber bracket 110mm", qty: 20, unit: "EA", raw: "Cast Iron Rubber bracket 110mm -20no" },
    ],
  },
  {
    label: "[Recovery] Radiators Type 22 — Catalyn 2025-02-05",
    description: "Type 22 radiators 500mm and 600mm height, plus Adrian's 10no follow-up",
    msgId: "6981fdbe-61f3-4965-b37e-67ff78701f25",
    date: "2025-02-05T15:11:45.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Radiator Type 22 500x500 or 600x500 (preferably 500mm tall)", qty: 7, unit: "EA", raw: "7no Type 22 500x500 or 600x500 preferably 500mm" },
      // follow-up from Adrian same thread — 10no nail clips
      { product: "Nail clips 2 pack (Adrian add-on 2025-02-06)", qty: 10, unit: "EA", raw: "Adrian follow-up: please add nail clips (2 pack), 10no" },
    ],
  },
  {
    label: "[Recovery] Talon Clips / Hep2o inserts — Majid 2025-02-05",
    description: "15mm Talon Clips + Hep2o inserts + Adrian 20no follow-up",
    msgId: "b4733f5f-dacb-43c6-b942-90f8fbd581f2",
    date: "2025-02-05T11:35:18.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Talon Clips 15mm", qty: 2, unit: "BAG", raw: "15mm Talon Clips - 2 Bags" },
      { product: "Hep2o Insert 15mm", qty: 300, unit: "EA", raw: "Hep2o Insert 15mm - 300 no." },
      { product: "Adrian follow-up item 20no (image omitted)", qty: 20, unit: "EA", raw: "Adrian follow-up: 20no please (image attached)" },
    ],
  },
  {
    label: "[Recovery] Copper pipe + Euro clip — Adrian 2025-01-24",
    description: "22mm copper pipe pack of 10, rubber-lined euro clip 15mm",
    msgId: "46595b66-cde6-4dc8-a2d7-5a308dff377f",
    date: "2025-01-24T10:15:14.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "22mm copper pipe (pack of 10)", qty: 2, unit: "PACK", raw: "22mm copper pipe pack of 10 -2no" },
      { product: "Rubber lined euro clip 15mm", qty: 30, unit: "EA", raw: "Rubber lined euro clip 15mm -30no" },
    ],
  },
  {
    label: "[Recovery] Copper T connectors — Adrian 2025-01-16",
    description: "Reducing tees 42-28-42, 54-28-54, 35-28-35, then 10 of each follow-up",
    msgId: "227677d5-63e7-4741-8f91-94ab064e25fe",
    date: "2025-01-16T16:12:10.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Copper T connector 42-28-42", qty: 10, unit: "EA", raw: "T connector copper 42-28-42 (initial 8, updated to 10 of each)" },
      { product: "Copper T connector 54-28-54", qty: 10, unit: "EA", raw: "T connector copper 54-28-54 (initial 2, updated to 10 of each)" },
      { product: "Copper T connector 35-28-35", qty: 10, unit: "EA", raw: "T connector copper 35-28-35 (initial 8, updated to 10 of each)" },
      { product: "Cast Iron Access pipe one end male one female 110mm", qty: 20, unit: "EA", raw: "Bro I need one end male another female 110mm, 20no please (image)" },
    ],
  },
  {
    label: "[Recovery] Paint order Supermatt + Vinyl Magnolia — Majid 2025-01-07",
    description: "Supermatt PBW 10L and Vinyl Matt Magnolia 10L for Catalin",
    msgId: "afb8b165-6023-4ff4-8cdc-d1749f2aee42",
    date: "2025-01-07T09:34:44.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Supermatt Matt PBW 10L", qty: 10, unit: "BUCKET", raw: "Supermatt Matt PBW 10l - 10 buckets" },
      { product: "Vinyl Matt Magnolia 10L", qty: 15, unit: "BUCKET", raw: "Vinyl Matt Magnolia 10l - 15 buckets" },
    ],
  },
];

// ---------- helpers ----------
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function existingMatches(existing, line) {
  // fuzzy: same msg + similar text + exact qty+unit ≈ duplicate
  const ln = norm(line.product);
  const lnTokens = new Set(ln.split(" ").filter((t) => t.length > 2));
  for (const e of existing) {
    const en = norm(e.normalizedProduct || "");
    const enTokens = new Set(en.split(" ").filter((t) => t.length > 2));
    let inter = 0;
    for (const t of lnTokens) if (enTokens.has(t)) inter++;
    const denom = Math.max(lnTokens.size, enTokens.size) || 1;
    const overlap = inter / denom;
    if (overlap >= 0.7 && Number(e.requestedQty) === Number(line.qty)) return e;
  }
  return null;
}

async function fetchExistingOnMsg(client, msgId) {
  const r = await client.query(
    `SELECT id, "normalizedProduct", "requestedQty", "requestedUnit", status
     FROM "BacklogTicketLine"
     WHERE "caseId"=$1 AND "sourceMessageId"=$2`,
    [CASE_ID, msgId],
  );
  return r.rows;
}

async function resolveThreadByPrefix(client, prefix) {
  const r = await client.query(
    `SELECT id FROM "BacklogOrderThread" WHERE "caseId"=$1 AND id LIKE $2`,
    [CASE_ID, prefix + "%"],
  );
  return r.rows[0]?.id || null;
}

async function insertTL(client, { threadId, msgId, date, sender, rawText, product, qty, unit, notes }) {
  const r = await client.query(
    `INSERT INTO "BacklogTicketLine"
       (id, "caseId", "orderThreadId", "sourceMessageId", date, sender,
        "rawText", "normalizedProduct", "requestedQty", "requestedUnit",
        status, notes)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, 'MESSAGE_LINKED', $10)
     RETURNING id`,
    [CASE_ID, threadId, msgId, date, sender, rawText, product, qty, unit, notes],
  );
  return r.rows[0].id;
}

async function createThread(client, { label, description, msgIds }) {
  const r = await client.query(
    `INSERT INTO "BacklogOrderThread" (id, "caseId", label, description, "messageIds", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
     RETURNING id`,
    [CASE_ID, label, description, msgIds],
  );
  return r.rows[0].id;
}

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();
  console.log(`Connected. DRY_RUN=${DRY_RUN}`);

  let createdTLsTask1 = 0;
  let skippedDupTask1 = 0;
  const task1Examples = [];

  console.log("\n=== TASK 1: re-extract mega-threads ===");
  for (const [shortMsg, cfg] of Object.entries(MEGA)) {
    const threadId = await resolveThreadByPrefix(client, cfg.threadPrefix);
    if (!threadId) {
      console.log(`  !! Thread ${cfg.threadPrefix} not found, skipping`);
      continue;
    }
    const existing = await fetchExistingOnMsg(client, cfg.msgId);
    console.log(`\n  Thread ${cfg.threadPrefix} (${threadId.slice(0,8)}) — msg ${shortMsg}`);
    console.log(`    Existing TLs: ${existing.length}, candidate new lines: ${cfg.lines.length}`);

    for (const line of cfg.lines) {
      const dup = existingMatches(existing, line);
      if (dup) {
        skippedDupTask1++;
        continue;
      }
      const notes = `Recovery Pass (Task 1) — re-extracted sub-line from message ${cfg.msgId.slice(0,8)}`;
      if (DRY_RUN) {
        createdTLsTask1++;
        task1Examples.push({ thr: threadId, product: line.product, qty: line.qty, unit: line.unit });
        continue;
      }
      const newId = await insertTL(client, {
        threadId,
        msgId: cfg.msgId,
        date: cfg.date,
        sender: cfg.sender,
        rawText: line.raw,
        product: line.product,
        qty: line.qty,
        unit: line.unit,
        notes,
      });
      createdTLsTask1++;
      task1Examples.push({ thr: threadId, product: line.product, qty: line.qty, unit: line.unit, id: newId });
    }
  }
  console.log(`\n  TASK 1 TOTAL: created ${createdTLsTask1} new TLs, skipped ${skippedDupTask1} duplicates`);

  let createdThreadsTask2 = 0;
  let createdTLsTask2 = 0;
  const task2Examples = [];

  console.log("\n=== TASK 2: create new threads for missed orders ===");
  for (const t of TASK2) {
    // Check if any thread already contains this message
    const existingThread = await client.query(
      `SELECT id, label FROM "BacklogOrderThread" WHERE "caseId"=$1 AND $2 = ANY("messageIds")`,
      [CASE_ID, t.msgId],
    );
    let threadId;
    if (existingThread.rows.length) {
      threadId = existingThread.rows[0].id;
      console.log(`  Thread already exists for msg ${t.msgId.slice(0,8)}: ${existingThread.rows[0].label} — will add lines to ${threadId.slice(0,8)}`);
    } else {
      if (DRY_RUN) {
        threadId = "DRY_THREAD_" + t.msgId.slice(0,8);
      } else {
        threadId = await createThread(client, {
          label: t.label,
          description: t.description,
          msgIds: [t.msgId],
        });
      }
      createdThreadsTask2++;
      console.log(`  Created thread ${threadId.slice ? threadId.slice(0,8) : threadId}: ${t.label}`);
    }

    const existing = await fetchExistingOnMsg(client, t.msgId);
    for (const line of t.lines) {
      const dup = existingMatches(existing, line);
      if (dup) continue;
      const notes = `Recovery Pass (Task 2) — new thread line from message ${t.msgId.slice(0,8)}`;
      if (DRY_RUN) {
        createdTLsTask2++;
        task2Examples.push({ thr: threadId, product: line.product, qty: line.qty, unit: line.unit });
        continue;
      }
      const newId = await insertTL(client, {
        threadId,
        msgId: t.msgId,
        date: t.date,
        sender: t.sender,
        rawText: line.raw,
        product: line.product,
        qty: line.qty,
        unit: line.unit,
        notes,
      });
      createdTLsTask2++;
      task2Examples.push({ thr: threadId, product: line.product, qty: line.qty, unit: line.unit, id: newId });
    }
  }
  console.log(`\n  TASK 2 TOTAL: created ${createdThreadsTask2} new threads, ${createdTLsTask2} new TLs`);

  console.log("\n=== FINAL STATE ===");
  const stats = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1) AS tl_total,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='INVOICED') AS tl_invoiced,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='UNMATCHED') AS tl_unmatched,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='MESSAGE_LINKED') AS tl_msg_linked,
       (SELECT COUNT(*) FROM "BacklogInvoiceLine" il LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
         WHERE il."caseId"=$1 AND bim.id IS NULL) AS inv_unmatched,
       (SELECT COUNT(*) FROM "BacklogOrderThread" WHERE "caseId"=$1) AS threads`,
    [CASE_ID],
  );
  console.log(stats.rows[0]);

  console.log(`\nTask 1 new lines: ${createdTLsTask1} (dup skips ${skippedDupTask1})`);
  console.log(`Task 2 new threads: ${createdThreadsTask2}, new lines: ${createdTLsTask2}`);
  console.log(`\nTop examples (Task 1):`);
  for (const e of task1Examples.slice(0, 15)) {
    console.log(`  thr=${(e.thr+"").slice(0,8)} qty=${e.qty}${e.unit}  ${e.product}`);
  }
  console.log(`\nTop examples (Task 2):`);
  for (const e of task2Examples.slice(0, 15)) {
    console.log(`  thr=${(e.thr+"").slice(0,8)} qty=${e.qty}${e.unit}  ${e.product}`);
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
