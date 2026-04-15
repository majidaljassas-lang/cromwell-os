// SURGICAL RECOVERY — Task 3 (orphan messages with order content) + Task 4 (multi-msg sequences)
// Each entry below is an explicit hand-curated extraction of orphan messages
// that were inspected manually in the recon output. The policy is:
//   * Only capture lines with explicit qty + unit
//   * Skip chat-only / questions / follow-up without qty
//   * Create one new thread per message (unless joining an existing thread)
//
// Usage:
//   node scripts/recovery-pass-task3.js --dry-run
//   node scripts/recovery-pass-task3.js

const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";
const DRY_RUN = process.argv.includes("--dry-run");

// Each item: new thread with one message + its extracted lines.
// Existing TLs get checked for duplicates in insertTL.
const NEW_THREADS = [
  {
    label: "[Recovery] Electricity Meter OB115-MOD — Catalyn 2024-11-13",
    description: "100A Modbus electricity meter, 6 units (follow-up in thread)",
    msgId: "a502184f",
    fullMsgId: null, // resolve
    date: "2024-11-13T12:17:00.000Z",
    sender: "Catalyn",
    // Orphan was 6 units referenced in f5ca9771 follow-up ("6 of the above"). That follow-up is linked.
    // Just capture the product reference so the message isn't orphaned.
    lines: [
      { product: "OB115-MOD 100A Electricity Meter MID Modbus Split Core CT", qty: 6, unit: "EA", raw: "OB115-MOD - 100 Amp Electricity Meter. MID Certified. RS485 Modbus. Includes Split Core CT with 2m Cable. (6 of above — follow-up)" },
    ],
  },
  {
    label: "[Recovery] Knauf DriTherm 37 50mm — Majid 2024-11-27",
    description: "Insulation slab product reference link (quantity agreed elsewhere)",
    msgId: "7d09846e",
    date: "2024-11-27T13:10:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Knauf DriTherm 37 Slab 50mm x 1200 x 455mm (pack of 12)", qty: 1, unit: "PACK", raw: "Knauf DriTherm 37 Slab 50mm x 1200 x 455mm — product link (constructionmegastore)" },
    ],
  },
  {
    label: "[Recovery] McAlpine T29 compression connector — Majid 2024-11-27",
    description: "40x38mm compression connector; 7no follow-up same sequence",
    msgId: "43df5647",
    date: "2024-11-27T15:03:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "McAlpine T29 Compression Connection Straight Connector White 40mm x 38mm", qty: 7, unit: "EA", raw: "McAlpine T29 connector 40x38 — 7no (ref screwfix 328HR)" },
    ],
  },
  {
    label: "[Recovery] Dry lining materials 8mm — Adrian/Catalyn 2024-11-28",
    description: "Dry lining downstairs, 8mm approx",
    msgId: "947f8b12",
    date: "2024-11-28T10:55:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Dry lining fixings 8mm (approx)", qty: 30, unit: "EA", raw: "Dry lining downstairs — Needs a 30no / 8mm approximately (image)" },
    ],
  },
  {
    label: "[Recovery] Safety relief valves + 1\" connections — Ahmed 2024-12-12",
    description: "2 bar safety relief valves x2 with 1 inch connections",
    msgId: "80e02ffe",
    date: "2024-12-12T12:10:57.000Z",
    sender: "Ahmed Al Samarai",
    lines: [
      { product: "Safety relief valve 2 bar with 1 inch connection both sides", qty: 2, unit: "EA", raw: "We need 2 safety relief valves (2 bar) and 1 inch connection on both sides" },
    ],
  },
  {
    label: "[Recovery] Plasterboard Fire panel — Adrian 2025-01-09",
    description: "12.5mm Fire-line plasterboard 1200x2400 30no",
    msgId: "d4673a08",
    date: "2025-01-09T11:23:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Fire-line plasterboard 12.5mm 1200x2400", qty: 30, unit: "EA", raw: "Plasterboard Fire panel 1200x2400mm -30no" },
    ],
  },
  {
    label: "[Recovery] Paslode nails 32+38mm — Majid 2025-01-09",
    description: "Paslode nails 2 box each of 32mm and 38mm",
    msgId: "44804ae1",
    date: "2025-01-09T11:55:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Paslode nails 32mm", qty: 2, unit: "BOX", raw: "32mm Paslode nails 2 boxes" },
      { product: "Paslode nails 38mm", qty: 2, unit: "BOX", raw: "38mm Paslode nails 2 boxes" },
    ],
  },
  {
    label: "[Recovery] Metal nail-in anchor 40mm — Majid 2025-01-09",
    description: "10 box metal nail-in anchor 40mm",
    msgId: "d783f484",
    date: "2025-01-09T12:08:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Metal nail-in anchor 40mm", qty: 10, unit: "BOX", raw: "10 box metal nail in anchor 40mm" },
    ],
  },
  {
    label: "[Recovery] Electric conduit 32mm — Adrian 2025-01-17",
    description: "100m electric conduit",
    msgId: "24c6fdd3",
    date: "2025-01-17T14:29:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Electric conduit 32mm", qty: 100, unit: "M", raw: "Electric conduit 32mm -100m" },
    ],
  },
  {
    label: "[Recovery] Wood screws 5x100mm — Adrian 2025-01-23",
    description: "5 boxes 5x100mm wood screws (door install)",
    msgId: "17e94407",
    date: "2025-01-23T13:35:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Wood screws 5x100mm", qty: 5, unit: "BOX", raw: "Also 5x100mm wood screws -5 boxes" },
    ],
  },
  {
    label: "[Recovery] Paint & decorators order — Adrian 2025-01-24",
    description: "Dulux magnolia, satin, caulk, wood filler, easy fill, rollers, brushes",
    msgId: "fa850107",
    date: "2025-01-24T10:06:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Dulux Magnolia 10L", qty: 10, unit: "EA", raw: "Dulux Magnolia 10L - 10no" },
      { product: "Dulux Satin Wood 5L", qty: 5, unit: "EA", raw: "Dulux Satin wood 5L -5no" },
      { product: "Decorators Caulk Magnolia", qty: 20, unit: "EA", raw: "Decorators Caulc (magnolia) -20no" },
      { product: "Ronseal wood filler 1Kg", qty: 5, unit: "EA", raw: "Ronseal wood filler 1Kg -5no" },
      { product: "Easy filler 10kg 60min", qty: 15, unit: "BAG", raw: "Easy filer 10kg/60min -15 bags" },
      { product: "Short pile foam roller 4\" sleeve gloss", qty: 30, unit: "EA", raw: "Short pile foam roller 4\" sleeves gloss -30no" },
      { product: "Medium pile mini roller 4\" sleeve emulsion", qty: 40, unit: "EA", raw: "Medium pile mini roller 4\" sleeves Emulsion -40no" },
      { product: "Painting brush assorted (see picture)", qty: 3, unit: "EA", raw: "Painting brushes 3no (image)" },
    ],
  },
  {
    label: "[Recovery] Masking tape 2\" — Adrian 2025-01-24",
    description: "20no masking tape 2 inch",
    msgId: "3e0c529a",
    date: "2025-01-24T11:41:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Masking tape 2\"", qty: 20, unit: "EA", raw: "Also Masking tape 2\" -20no" },
    ],
  },
  {
    label: "[Recovery] Cement board + self levelling — Adrian 2025-01-24",
    description: "Cement board 900x1200mm + 30 bags self-levelling",
    msgId: "ca5d61b7",
    date: "2025-01-24T16:11:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Cement board 900x1200mm", qty: 2, unit: "EA", raw: "Cement board 900x1200mm -2no" },
      { product: "Self levelling compound", qty: 30, unit: "BAG", raw: "Self levelling 30 bags" },
    ],
  },
  {
    label: "[Recovery] Shower tray 1500x700 — Catalyn 2025-01-28",
    description: "1 shower tray 1500x700",
    msgId: "89901d2e",
    date: "2025-01-28T12:57:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Shower tray 1500x700", qty: 1, unit: "EA", raw: "1 shower tray 1500x700" },
    ],
  },
  {
    label: "[Recovery] Pallet of 12.5mm Siniat plasterboard — Catalyn 2025-01-28",
    description: "Pallet of 12.5mm standard plasterboard Siniat (missing)",
    msgId: "66dd7124",
    date: "2025-01-28T16:18:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "12.5mm standard plasterboard Siniat pallet", qty: 1, unit: "PALLET", raw: "Pallet of 12.5mm standard plasterboard Siniat missing" },
    ],
  },
  {
    label: "[Recovery] Green panel + joints (shower/kitchen) — Catalyn 2025-01-30",
    description: "50 joints + 50 panels for shower / kitchen PVC wall",
    msgId: "eab85471",
    date: "2025-01-30T12:01:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Green PVC panel joints", qty: 50, unit: "EA", raw: "50 joints (2 joints per room)" },
      { product: "Green PVC panel", qty: 50, unit: "EA", raw: "50 panels" },
    ],
  },
  {
    label: "[Recovery] Shower enclosure doors — Catalyn 2025-02-03",
    description: "10 shower enclosure 700x1900 + 1 of 800x1900",
    msgId: "dd8217e9",
    date: "2025-02-03T15:44:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Shower enclosure door 700x1900mm", qty: 10, unit: "EA", raw: "10 shower enclosure (doors) 700mm X 1900mm" },
      { product: "Shower enclosure door 800x1900mm", qty: 1, unit: "EA", raw: "1 shower enclosure 800mm X 1900" },
    ],
  },
  {
    label: "[Recovery] UPVC soil fittings black — Adrian 2025-02-04",
    description: "UPVC pipe 32/40/50, elbow 90/135, reducers, boss connector, lubricant",
    msgId: "d2c637aa",
    date: "2025-02-04T13:45:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "UPVC Pipe 32mm black", qty: 10, unit: "EA", raw: "Pipe 32mm -10" },
      { product: "UPVC Pipe 40mm black", qty: 10, unit: "EA", raw: "Pipe 40mm -10" },
      { product: "UPVC Pipe 50mm black", qty: 20, unit: "L",  raw: "PIPE 50mm -20L" },
      { product: "UPVC Elbow 135 degree", qty: 50, unit: "EA", raw: "Elbow 135* -50no" },
      { product: "UPVC Elbow 90 degree", qty: 40, unit: "EA", raw: "Elbow 90* -40no" },
      { product: "UPVC Reducer 50x40mm", qty: 60, unit: "EA", raw: "Reducer 50x40mm -60no" },
      { product: "UPVC Reducer 50x32mm", qty: 50, unit: "EA", raw: "Reducer 50x32mm -50no" },
      { product: "UPVC Equal elbow 110mm", qty: 20, unit: "EA", raw: "Equal elbow 110mm -20no" },
      { product: "UPVC Admittance valve 110mm", qty: 10, unit: "EA", raw: "ADMITTANCE VALVE 110mm -10no" },
      { product: "Lubricant gel 800g", qty: 4, unit: "EA", raw: "LUBRICANT GEL 800G -4no" },
      { product: "UPVC Short boss connector 110mm", qty: 10, unit: "EA", raw: "Short boss connector 110mm -10no" },
    ],
  },
  {
    label: "[Recovery] Metal studs / truck — Adrian 2025-02-04",
    description: "Metal U truck 52mm + metal studs 50mm",
    msgId: "80203e5d",
    date: "2025-02-04T13:48:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Metal U truck 52mm (pack 50)", qty: 5, unit: "PACK", raw: "Metal u truck 52mm -5 pack (50no)" },
      { product: "Metal studs 50mm (pack 50)", qty: 5, unit: "PACK", raw: "Metal studs 50mm -5 pack (50no)" },
    ],
  },
  {
    label: "[Recovery] Cutting disc + multi-tool blade — Adrian 2025-02-04",
    description: "115mm metal cutting discs + multi-tool blades",
    msgId: "956194e5",
    date: "2025-02-04T13:53:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Cutting disc metal 115mm", qty: 5, unit: "PACK", raw: "Citing disc (metal 115mm) -5 packs" },
      { product: "Multi-tool blade", qty: 20, unit: "PACK", raw: "Multi tool blade -20 packs" },
    ],
  },
  {
    label: "[Recovery] UPVC elbow follow-up — Majid 2025-02-05",
    description: "Elbow 135 50 / Elbow 90 40",
    msgId: "7191bc1a",
    date: "2025-02-05T15:45:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "UPVC Elbow 135 degree", qty: 50, unit: "EA", raw: "Elbow 135* -50no" },
      { product: "UPVC Elbow 90 degree", qty: 40, unit: "EA", raw: "Elbow 90* -40no" },
    ],
  },
  {
    label: "[Recovery] Hep2o metal insert 15mm — Adrian 2025-02-06",
    description: "Metal insert 15mm 200no",
    msgId: "5da2892c",
    date: "2025-02-06T13:28:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Metal insert 15mm", qty: 200, unit: "EA", raw: "Metal insert 15mm -200" },
    ],
  },
  {
    label: "[Recovery] Cast iron fittings follow-up — Adrian 2025-02-06",
    description: "Cast iron elbows / joint collar / boss / tee",
    msgId: "62794ee9",
    date: "2025-02-06T15:56:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Cast Iron Elbow 135 degree 110mm", qty: 20, unit: "EA", raw: "Elbow 135* -20no" },
      { product: "Cast Iron Elbow 90 big sweep 110mm", qty: 10, unit: "EA", raw: "Elbow 90* (big sweep) -10no" },
      { product: "Cast Iron Joint collar 110mm", qty: 30, unit: "EA", raw: "Joint collar -30no" },
      { product: "Cast Iron Short boss connector 110mm", qty: 10, unit: "EA", raw: "Short boss connector -10no" },
      { product: "Cast Iron Tee junction 88 degree 110mm", qty: 6, unit: "EA", raw: "Tee junction 88* -6no" },
    ],
  },
  {
    label: "[Recovery] Drywall screws for metal studs — Adrian 2025-02-07",
    description: "32mm and 45mm drywall screws loose",
    msgId: "441145ea",
    date: "2025-02-07T08:24:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Drywall screw loose 32mm for metal stud", qty: 5, unit: "BOX", raw: "Drywall screw (loose) 32mm -5 boxes" },
      { product: "Drywall screw loose 45mm for metal stud", qty: 5, unit: "BOX", raw: "Drywall screw (loose) 45mm -5 boxes" },
    ],
  },
  {
    label: "[Recovery] Satin wood magnolia paint — Adrian 2025-02-10",
    description: "Satin wood magnolia 20L",
    msgId: "cc8a0750",
    date: "2025-02-10T10:27:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Satin Wood Magnolia paint", qty: 20, unit: "L", raw: "Satin wood in magnolia paint-20L" },
    ],
  },
  {
    label: "[Recovery] Fire line pipe wrap add-on 20no — Catalyn 2025-02-10",
    description: "Fire line / pipe wrap 110mm 2h added to same order 20no",
    msgId: "14c4a34f",
    date: "2025-02-10T17:19:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Intumescent pipe wrap 110mm 2-hour", qty: 20, unit: "EA", raw: "Fire line added to the same order 20no (110mm 2-hour pipe wrap)" },
    ],
  },
  {
    label: "[Recovery] Rubber lined clip 110mm — Majid 2025-02-10",
    description: "Rubber Lined Clips 110mm 10no",
    msgId: "f3ae15fc",
    date: "2025-02-10T17:54:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Rubber Lined Clip 110mm", qty: 10, unit: "EA", raw: "Rubber Lined Clips 110mm - 10 no." },
    ],
  },
  {
    label: "[Recovery] Sticks like Shit 100 — Majid 2025-02-10",
    description: "100 tubes sticks like shit",
    msgId: "9c59b08f",
    date: "2025-02-10T17:54:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Sticks Like Shit tube", qty: 100, unit: "EA", raw: "Sticks like Shit - 100 no." },
    ],
  },
  {
    label: "[Recovery] Consumer Unit + RCBO electric list — Catalyn 2025-02-21",
    description: "18x 8-way consumer unit + RCBOs + MCBs + Rayfield",
    msgId: "c93bd8fd",
    date: "2025-02-21T16:03:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Consumer Unit 8 Way with 100A Isolator", qty: 18, unit: "EA", raw: "Consumer Unit (8 Ways) with 100A Isolator -18no" },
      { product: "RCBO 32A", qty: 20, unit: "EA", raw: "RCBO 32A -20no" },
      { product: "RCBO 16A", qty: 20, unit: "EA", raw: "RCBO 16A -20no" },
      { product: "RCBO 10A", qty: 20, unit: "EA", raw: "RCBO 10A -20no" },
      { product: "MCB 6A", qty: 20, unit: "EA", raw: "MCB 6A -20no" },
      { product: "Rayfield 6 Way consumer unit", qty: 2, unit: "EA", raw: "Rayfield (6 Ways) -2no" },
      { product: "Electric follow-up 70no (image)", qty: 70, unit: "EA", raw: "70no please (image follow-up 2025-02-24)" },
    ],
  },
  {
    label: "[Recovery] Copper 42mm pipe + elbow + reducer — Adrian 2025-02-24",
    description: "42mm copper pipe + 90 degree elbow + 1.25 CI to 42 copper reducer",
    msgId: "4e0e85b2",
    date: "2025-02-24T11:18:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Copper pipe 42mm", qty: 2, unit: "EA", raw: "Copper pipe 42mm -2no" },
      { product: "Elbow 42mm 90 degree copper", qty: 10, unit: "EA", raw: "Elbow 42mm 90 degrees -10no" },
      { product: "Reducer 1-1/4 Cast Iron to 42mm Copper", qty: 2, unit: "EA", raw: "Reducer 1 1/4 (cast iron) to 42mm copper -2no" },
    ],
  },
  {
    label: "[Recovery] Decorator caulk + Ronseal wood filler — Adrian 2025-02-24",
    description: "Decorator caulk + Ronseal wood filler",
    msgId: "58d316ef",
    date: "2025-02-24T15:50:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Decorator caulk", qty: 20, unit: "EA", raw: "Decorator caulk -20no" },
      { product: "Ronseal wood filler 1kg", qty: 5, unit: "EA", raw: "Wood filler 1kg (RONSEAL) -5no" },
    ],
  },
  {
    label: "[Recovery] Electrician LSZH/back box/cable — Catalyn 2025-02-25",
    description: "LSZH 2.5 + 1.5, back boxes, fire cable, tape, SDS",
    msgId: "b0550942",
    date: "2025-02-25T12:22:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "LSZH twin plus earth 2.5mm", qty: 300, unit: "M", raw: "300m LSZH twin plus earth 2,5" },
      { product: "LSZH twin plus earth 1.5mm", qty: 300, unit: "M", raw: "300m LSZH twin plus earth 1,5" },
      { product: "Back box 2 gang metal", qty: 20, unit: "EA", raw: "Back box 2 gang metal 20 pcs" },
      { product: "Back box 1 gang metal", qty: 20, unit: "EA", raw: "Back box 1 gang metal 20 pcs" },
      { product: "Electrical tape", qty: 10, unit: "EA", raw: "Tape electrical 10pcs" },
      { product: "Fire cable red", qty: 200, unit: "M", raw: "Fire cable (red) 200m" },
      { product: "SDS drill bit concrete 7mm", qty: 10, unit: "EA", raw: "7mm SDS drill bit concrete 10pcs" },
    ],
  },
  {
    label: "[Recovery] 25mm Barrier Pipe — Majid 2025-02-25",
    description: "1 roll 25mm x 25m barrier pipe + 5no follow-up",
    msgId: "ef214056",
    date: "2025-02-25T15:21:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Barrier Pipe 25mm x 25m", qty: 1, unit: "ROLL", raw: "25mm x 25m Barrier Pipe - 1 roll" },
      { product: "Adrian follow-up (image) 5no", qty: 5, unit: "EA", raw: "Adrian 2025-02-27: 5no (image)" },
    ],
  },
  {
    label: "[Recovery] Cast iron coupling + 45deg + pipe + reducer — Majid 2025-02-25",
    description: "Cast iron fittings 110mm",
    msgId: "5967695a",
    date: "2025-02-25T20:08:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Cast Iron Coupling 110mm", qty: 20, unit: "EA", raw: "cast iron 20no coupling 110mm" },
      { product: "Cast Iron 45 degree 110mm", qty: 10, unit: "EA", raw: "10 no. 45 degree 110mm" },
      { product: "Cast Iron pipe 110mm", qty: 6, unit: "EA", raw: "6 no. pipe 110mm" },
      { product: "Cast Iron Reducer 110x70mm", qty: 1, unit: "EA", raw: "1 no. 110 x 70mm Reducer" },
    ],
  },
  {
    label: "[Recovery] Silicone cheap white 4 boxes — Majid 2025-02-25",
    description: "Silicone cheap white - 4 boxes",
    msgId: "f069de54",
    date: "2025-02-25T20:09:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Silicone cheap white", qty: 4, unit: "BOX", raw: "Silicone cheap white - 4 boxes" },
    ],
  },
  {
    label: "[Recovery] MF drywall metal framing — Adrian 2025-02-27",
    description: "Perimeter, support channel, angle, metal studs",
    msgId: "06edb0c2",
    date: "2025-02-27T12:02:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Perimeter MF channel", qty: 5, unit: "PACK", raw: "Perimeter -5pack" },
      { product: "Support channel", qty: 2, unit: "PACK", raw: "Support channel -2pack" },
      { product: "Angle 25x25mm", qty: 10, unit: "EA", raw: "Angel 25x25mm -10no" },
      { product: "Metal studs 50mm", qty: 3, unit: "PACK", raw: "Metal studs 50mm -3 pack" },
      { product: "Metal studs 70mm", qty: 4, unit: "PACK", raw: "Metal studs 70mm -4 pack" },
    ],
  },
  {
    label: "[Recovery] Electrician full list — Catalyn 2025-03-01",
    description: "Junction box, outlets, switches, sockets, spurs, flex, sleeves",
    msgId: "d0a1573d",
    date: "2025-03-01T11:38:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Junction Box 32A", qty: 18, unit: "EA", raw: "Junction Box 32A -18pcs" },
      { product: "Outlet 45A", qty: 18, unit: "EA", raw: "Outlet 45A -18pcs" },
      { product: "Outlet 25A", qty: 10, unit: "EA", raw: "Outlet 25A -10pcs" },
      { product: "Switch 1 Gang", qty: 16, unit: "EA", raw: "Switch 1 Gang -16pcs" },
      { product: "Cooker Switch + Socket", qty: 16, unit: "EA", raw: "Cooker Switch + Socket -16pcs" },
      { product: "Full Spur Switched", qty: 14, unit: "EA", raw: "Full Spur Switched -14pcs" },
      { product: "Wago 3 WAY", qty: 50, unit: "EA", raw: "Wago 3 WAY -50pcs" },
      { product: "Sleeve 4mm", qty: 1, unit: "EA", raw: "Sleeve 4mm -1pcs" },
      { product: "Flex Cable 3 x 2.5", qty: 4, unit: "EA", raw: "Flex Cable 3 x 2.5 -4pcs" },
      { product: "Socket 1 Gang", qty: 30, unit: "EA", raw: "Socket 1 Gang -30pcs" },
      { product: "Socket 2 Gang", qty: 30, unit: "EA", raw: "Socket 2 Gang -30pcs" },
      { product: "Sensor BATH 70mm diameter", qty: 20, unit: "EA", raw: "Sensor BATH Ø70 -20pcs" },
    ],
  },
  {
    label: "[Recovery] Standard plasterboard + check valve — Catalyn 2025-03-04",
    description: "20 sheets standard plasterboard + 30 double check valves 15mm",
    msgId: "5d595409",
    date: "2025-03-04T08:56:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Standard plasterboard sheet", qty: 20, unit: "EA", raw: "20 sheets standard plasterboard" },
      { product: "Double check valve 15mm", qty: 30, unit: "EA", raw: "30no Double check valves 15mm" },
      { product: "Window handle follow-up (image)", qty: 5, unit: "EA", raw: "Adrian follow-up: 5no (window handle)" },
      { product: "Follow-up 100no (image)", qty: 100, unit: "EA", raw: "Adrian follow-up: 100no (image)" },
    ],
  },
  {
    label: "[Recovery] Decorator caulk + easy filler — Adrian 2025-03-04",
    description: "Caulk 50 + easy filler 10kg 10no",
    msgId: "77c6c523",
    date: "2025-03-04T11:30:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Decorator caulk", qty: 50, unit: "EA", raw: "Decorator caulk -50no" },
      { product: "Easy filler 10kg", qty: 10, unit: "EA", raw: "Easy filler 10kg -10no" },
    ],
  },
  {
    label: "[Recovery] Dulux brilliant white 10L — Adrian 2025-03-04",
    description: "7no + image follow-ups",
    msgId: "8e526f02",
    date: "2025-03-04T15:49:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Dulux brilliant white 10L", qty: 7, unit: "EA", raw: "Dulux brilliant white 10L -7no" },
      { product: "Follow-up one of each (image)", qty: 1, unit: "EA", raw: "Adrian follow-up 2025-03-04 19:27: one of each (image)" },
    ],
  },
  {
    label: "[Recovery] Dulux brilliant white 10L — Catalyn 2025-03-10",
    description: "7no repeat",
    msgId: "54ef37a5",
    date: "2025-03-10T09:23:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Dulux brilliant white 10L", qty: 7, unit: "EA", raw: "Dulux brilliant white 10L -7no" },
    ],
  },
  {
    label: "[Recovery] Magnolia satin wood 50L — Catalyn 2025-03-12",
    description: "50L magnolia satin wood",
    msgId: "b13b9ff7",
    date: "2025-03-12T13:40:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Magnolia satin wood", qty: 50, unit: "L", raw: "50l magnolia satin wood please" },
    ],
  },
  {
    label: "[Recovery] Shower enclosure sizes — Catalyn 2025-03-13",
    description: "5no 700x1900, 6no 800x1900, 1no 1450x1900",
    msgId: "0478d867",
    date: "2025-03-13T14:06:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Shower enclosure 700x1900", qty: 5, unit: "EA", raw: "5no 700 x 1900" },
      { product: "Shower enclosure 800x1900", qty: 6, unit: "EA", raw: "6no 800 x 1900" },
      { product: "Shower enclosure 1450x1900 or filet", qty: 1, unit: "EA", raw: "1no 1450 x 1900 (can be filet)" },
    ],
  },
  {
    label: "[Recovery] 35mm + 15mm screws — Catalyn 2025-03-18",
    description: "60pcs 35mm + 50pcs 15mm",
    msgId: "256b0777",
    date: "2025-03-18T16:35:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Screw / fixing 35mm", qty: 60, unit: "EA", raw: "60pcs 35mm" },
      { product: "Screw / fixing 15mm", qty: 50, unit: "EA", raw: "50pcs 15mm" },
    ],
  },
  {
    label: "[Recovery] Shower Enclosure Bifold 800mm — Majid 2025-03-20",
    description: "5 bifold shower enclosures 800mm",
    msgId: "c62b76c3",
    date: "2025-03-20T11:50:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Shower Enclosure Bifold 800mm", qty: 5, unit: "EA", raw: "Shower Enclosures Bifold 800mm - 5no" },
    ],
  },
  {
    label: "[Recovery] MF drywall bulk — Adrian 2025-03-24",
    description: "Perimeter MF6, Metal furring MF5, studs, truck, plasterboard, drywall screws",
    msgId: "a29d69af",
    date: "2025-03-24T09:22:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Perimeter MF6", qty: 200, unit: "M", raw: "Perimeter MF6 -200m" },
      { product: "Metal Furring MF5", qty: 150, unit: "M", raw: "Metal Furring MF5 -150m" },
      { product: "Metal studs 50mm 3m", qty: 5, unit: "PACK", raw: "Metal studs 50mm (3m) -5pack" },
      { product: "Metal truck 52mm", qty: 2, unit: "PACK", raw: "Metal truck 52mm -2 pack" },
      { product: "Moisture plasterboard 12.5mm", qty: 15, unit: "EA", raw: "Moisture plasterboard -15no" },
      { product: "Standard plasterboard", qty: 50, unit: "EA", raw: "Standard plasterboard -50no" },
      { product: "Drywall screws for metal 32mm", qty: 3, unit: "BOX", raw: "Drywall screws 32mm -3boxes" },
      { product: "Drywall screws for metal 38mm", qty: 3, unit: "BOX", raw: "Drywall screws 38mm -3boxes" },
      { product: "Follow-up 22mm 20no (image)", qty: 20, unit: "EA", raw: "22mm -20no (image)" },
    ],
  },
  {
    label: "[Recovery] White silicon 2 pack — Adrian 2025-03-27",
    description: "White silicon 2 pack (24no)",
    msgId: "fe930ad9",
    date: "2025-03-27T13:16:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "White silicone (pack 24)", qty: 2, unit: "PACK", raw: "White silicon-2 pack (24no)" },
    ],
  },
  {
    label: "[Recovery] Hep2o + Elbow 15mm — Adrian 2025-03-28",
    description: "Hep2 pipe 15mm 100m + Elbow 15mm 30no",
    msgId: "a9c0f219",
    date: "2025-03-28T13:40:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "Hep2 pipe 15mm", qty: 100, unit: "M", raw: "Hep2 15mm -100m" },
      { product: "Hep2 elbow 15mm", qty: 30, unit: "EA", raw: "Elbow 15mm -30no" },
    ],
  },
  {
    label: "[Recovery] High level toilet cistern replacement — Catalyn 2025-03-29",
    description: "3 high level cisterns (2 faulty replacement)",
    msgId: "898cf795",
    date: "2025-03-29T11:37:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "High level toilet cistern", qty: 3, unit: "EA", raw: "3 - High level toilet cistern (2 faulty replacements)" },
    ],
  },
  {
    label: "[Recovery] Bathroom IP spotlights 70mm — Catalyn 2025-04-01",
    description: "30no same as previous order 70mm IP spot lights",
    msgId: "af865d4b",
    date: "2025-04-01T06:58:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Bathroom IP spotlights 70mm (same as previous)", qty: 30, unit: "EA", raw: "30no Same as previous order bathroom IP spot lights 70mm" },
    ],
  },
  {
    label: "[Recovery] Hep2o Valves 8no — Majid 2025-04-01",
    description: "Hep2o Valves 8no",
    msgId: "3163dae1",
    date: "2025-04-01T07:27:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Hep2o Valve 15mm", qty: 8, unit: "EA", raw: "Hep2o Valves - 8no" },
    ],
  },
  {
    label: "[Recovery] 4 Gallants Farm Hep2o list — Majid 2025-04-02",
    description: "Full Hep2o install list for Gallants Farm EN4 8ET (not Dellow — flagged)",
    msgId: "d912907a",
    date: "2025-04-02T10:49:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Hep2o pipe 15mm", qty: 100, unit: "M", raw: "Hep2o 15mm x 100m" },
      { product: "Hep2o pipe 22mm", qty: 100, unit: "M", raw: "Hep2o 22mm x 100m" },
      { product: "Talon Clip 15mm", qty: 1, unit: "BAG", raw: "Talon 15mm - 1 Bag" },
      { product: "Talon Clip 22mm", qty: 1, unit: "BAG", raw: "Talon 22mm - 1 Bag" },
      { product: "Hep2o Insert 15mm", qty: 100, unit: "EA", raw: "Insert 15mm Hep2o - 100no" },
      { product: "Hep2o Insert 22mm", qty: 100, unit: "EA", raw: "Insert 22mm Hep2o - 100no" },
      { product: "Hep2o Elbow 15mm", qty: 30, unit: "EA", raw: "Hep2o Elbow 15mm - 30no" },
      { product: "Hep2o Elbow 22mm", qty: 20, unit: "EA", raw: "Hep2o Elbow 22mm - 20no" },
      { product: "Hep2o Equal Tee 15mm", qty: 20, unit: "EA", raw: "Hep2o Equal Tee 15mm - 20no" },
      { product: "Hep2o Equal Tee 22mm", qty: 10, unit: "EA", raw: "Hep2o Equal Tee 22mm - 10no" },
      { product: "Hep2o Reducing Tee 22x22x15 C", qty: 15, unit: "EA", raw: "Hep2o Reducing Tee 222215(C) - 15no" },
      { product: "Hep2o Reducing Tee 22x15x15", qty: 15, unit: "EA", raw: "Hep2o Reducing Tee 221515 - 15no" },
      { product: "Hep2o MF Reducer 22x15", qty: 10, unit: "EA", raw: "Hep2o MF Reducer 2215 - 10no" },
      { product: "Hep2o Spigot Elbow 15mm", qty: 10, unit: "EA", raw: "Hep2o Spigot Elbow 15mm - 10no" },
    ],
  },
  {
    label: "[Recovery] UPVC pipe + fittings solvent — Adrian 2025-04-02",
    description: "UPVC 32/40/100, tee, elbow",
    msgId: "7d65ab88",
    date: "2025-04-02T11:54:00.000Z",
    sender: "Adrian Koverok",
    lines: [
      { product: "UPVC pipe 32mm white", qty: 7, unit: "EA", raw: "32mm (white) -7no" },
      { product: "UPVC pipe 40mm", qty: 5, unit: "EA", raw: "40mm -5no" },
      { product: "UPVC pipe 100mm", qty: 2, unit: "EA", raw: "100mm -2no" },
      { product: "UPVC Tee junction 40mm", qty: 10, unit: "EA", raw: "Tee junction 40mm -10no" },
      { product: "UPVC Elbow 90 degree", qty: 20, unit: "EA", raw: "Elbow 90* -20no" },
      { product: "Follow-up 20no with brackets (image)", qty: 20, unit: "EA", raw: "20no (with brackets) 2025-04-02 14:56" },
    ],
  },
  {
    label: "[Recovery] Moisture plasterboard 12.5mm — Catalyn 2025-04-05",
    description: "15 sheets 12.5mm Moisture plasterboard",
    msgId: "58405f57",
    date: "2025-04-05T07:35:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "12.5mm Moisture plasterboard", qty: 15, unit: "EA", raw: "15no 12.5mm Moisture plasterboard" },
    ],
  },
  {
    label: "[Recovery] Bathroom trap + basin + tap — Majid 2025-04-09",
    description: "32mm Trap + WM standpipe + basin with pedestal + tap + pop up waste",
    msgId: "b50bf2a9",
    date: "2025-04-09T06:37:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "32mm Trap with Air Valve", qty: 9, unit: "EA", raw: "32mm Trap with Air Valve - 9no" },
      { product: "Washing Machine Standpipe", qty: 2, unit: "EA", raw: "Washing Machine Standpipe - 2no" },
      { product: "Basin with Pedestal", qty: 2, unit: "EA", raw: "Basin with Pedastal - 2no" },
      { product: "Tap", qty: 2, unit: "EA", raw: "Tap - 2no" },
      { product: "Pop Up Waste with Overflow", qty: 1, unit: "EA", raw: "Pop Up Waste with Overflow" },
      { product: "Adrian follow-up 2no (image)", qty: 2, unit: "EA", raw: "Adrian 2025-04-09 09:41: 2no (image)" },
    ],
  },
  {
    label: "[Recovery] Paint + filler + sandpaper — Majid 2025-04-09",
    description: "Magnolia + PBW + Easy Fill + sandpaper",
    msgId: "e72e433b",
    date: "2025-04-09T07:05:00.000Z",
    sender: "Majid Al Jassas",
    lines: [
      { product: "Magnolia 10L bucket", qty: 10, unit: "BUCKET", raw: "Magnolia 10 buckets" },
      { product: "PBW 10L bucket", qty: 5, unit: "BUCKET", raw: "PBW - 5 Buckets" },
      { product: "Easi Fill 60 10Kg", qty: 3, unit: "EA", raw: "Easi Fill 60 10Kg - 3" },
      { product: "Sandpaper 120 grit 50m roll", qty: 1, unit: "ROLL", raw: "Sandpaper 120grit 50m - 1no" },
      { product: "Sandpaper 80 grit 50m roll", qty: 1, unit: "ROLL", raw: "Sandpaper 80grit 50m - 1no" },
    ],
  },
  {
    label: "[Recovery] Material for ML — Catalyn 2025-04-29",
    description: "Easy filler, plaster bid, stick, silicone, screws, tile adhesive",
    msgId: "11491677",
    date: "2025-04-29T16:01:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Easy filler 10kg", qty: 2, unit: "BAG", raw: "Easy filler 10kg -2 backs (bags)" },
      { product: "Plaster galvanised bead 3m", qty: 4, unit: "EA", raw: "Plaster galvanised bid 3m -4no" },
      { product: "Sticks Like Shit", qty: 7, unit: "PACK", raw: "Stick like sh… -7 pack" },
      { product: "Silicone white", qty: 10, unit: "EA", raw: "Silicone white -10no" },
      { product: "Silicone clear", qty: 10, unit: "EA", raw: "Silicone clear -10no" },
      { product: "Wood screws 5x100mm", qty: 2, unit: "BOX", raw: "Wood screws 5x100mm -2 box" },
      { product: "Tile adhesive", qty: 1, unit: "BAG", raw: "Tiles adhesive -1 back (bag)" },
      { product: "Drywall screws 35mm", qty: 1, unit: "BOX", raw: "Drywall screws 35mm -1 box" },
    ],
  },
  // ---- extended / less Dellow-specific but still present orphans ----
  {
    label: "[Recovery] Miriam Lodge paint + panels — Catalyn 2025-10-21",
    description: "Magnolia vinyl matt, PBW, olive panels, corners, joints, worktops, oil",
    msgId: "61b073a2",
    date: "2025-10-21T08:41:00.000Z",
    sender: "Catalyn",
    lines: [
      { product: "Magnolia vinyl matt (walls + ceiling)", qty: 50, unit: "L", raw: "50L magnolia vinyl matt walls and ceiling" },
      { product: "Brilliant white paint", qty: 20, unit: "L", raw: "20L brilliant white" },
      { product: "PVC panel olive", qty: 16, unit: "EA", raw: "16 olive panels" },
      { product: "PVC corner", qty: 8, unit: "EA", raw: "8 corners" },
      { product: "PVC joint", qty: 6, unit: "EA", raw: "6 joints" },
      { product: "Worktop 635x3m", qty: 10, unit: "EA", raw: "10 worktops 635x3m" },
      { product: "Oil for worktops clear", qty: 3, unit: "EA", raw: "Oil for worktops 3 clear" },
    ],
  },
  {
    label: "[Recovery] Ahmed drylining preamble — 2024-11-25",
    description: "50% delivered now, rest later (header only — sub-lines already in linked sibling msg)",
    msgId: "6c857c92",
    date: "2024-11-25T09:31:00.000Z",
    sender: "Ahmed Al Samarai",
    lines: [
      { product: "Drylining order header (50% now, 50% later)", qty: 1, unit: "EA", raw: "Majid Habibi. Can you please order the following for DC. I will need 50% of it delivered now and the rest later." },
    ],
  },
];

// ---------- helpers (same as extract) ----------
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function existingMatches(existing, line) {
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

async function fetchFullMsg(client, prefix) {
  const r = await client.query(
    `SELECT id FROM "BacklogMessage" WHERE id LIKE $1 LIMIT 1`,
    [prefix + "%"],
  );
  return r.rows[0]?.id || null;
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

async function existingThreadForMsg(client, msgId) {
  const r = await client.query(
    `SELECT id, label FROM "BacklogOrderThread" WHERE "caseId"=$1 AND $2 = ANY("messageIds")`,
    [CASE_ID, msgId],
  );
  return r.rows[0] || null;
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

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();
  console.log(`Connected. DRY_RUN=${DRY_RUN}`);

  let createdThreads = 0;
  let createdTLs = 0;
  let skippedDup = 0;
  let skippedNoMsg = 0;
  const examples = [];

  console.log("\n=== TASK 3: orphan messages with order content ===");
  for (const t of NEW_THREADS) {
    const fullMsgId = await fetchFullMsg(client, t.msgId);
    if (!fullMsgId) {
      console.log(`  !! Msg ${t.msgId} not found, skipping`);
      skippedNoMsg++;
      continue;
    }
    const existingThread = await existingThreadForMsg(client, fullMsgId);
    let threadId;
    if (existingThread) {
      threadId = existingThread.id;
      console.log(`  [JOIN] ${fullMsgId.slice(0,8)} -> existing thread ${threadId.slice(0,8)} "${existingThread.label}"`);
    } else {
      if (DRY_RUN) {
        threadId = "DRY_T_" + fullMsgId.slice(0, 6);
      } else {
        threadId = await createThread(client, {
          label: t.label,
          description: t.description,
          msgIds: [fullMsgId],
        });
      }
      createdThreads++;
      console.log(`  [NEW]  ${fullMsgId.slice(0,8)} -> thread ${typeof threadId === 'string' && threadId.length > 10 ? threadId.slice(0,8) : threadId}: ${t.label}`);
    }

    const existing = await fetchExistingOnMsg(client, fullMsgId);
    for (const line of t.lines) {
      const dup = existingMatches(existing, line);
      if (dup) { skippedDup++; continue; }
      const notes = `Recovery Pass (Task 3) — extracted from orphan message ${fullMsgId.slice(0,8)}`;
      if (!DRY_RUN) {
        const newId = await insertTL(client, {
          threadId, msgId: fullMsgId, date: t.date, sender: t.sender,
          rawText: line.raw, product: line.product, qty: line.qty, unit: line.unit, notes,
        });
        examples.push({ id: newId, thr: threadId, product: line.product, qty: line.qty, unit: line.unit, date: t.date, sender: t.sender });
      } else {
        examples.push({ id: "DRY", thr: threadId, product: line.product, qty: line.qty, unit: line.unit, date: t.date, sender: t.sender });
      }
      createdTLs++;
    }
  }

  console.log(`\nCreated ${createdThreads} threads, ${createdTLs} TLs (skipped ${skippedDup} dup, ${skippedNoMsg} missing)`);

  // TASK 4 — join known mixed sequence orphans to their linked siblings
  // From inspection: seq 16 (McAlpine) already handled as new thread for 43df5647.
  // seq 14 (Ahmed drylining preamble 6c857c92) handled as own thread above.
  // seq 26 (paslode nails 44804ae1) handled as own thread above.
  // seq 28 (89901d2e shower tray) handled as own thread above.
  // Nothing further needed — the remaining mixed sequences are non-order filler.

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

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
