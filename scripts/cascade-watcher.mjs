#!/usr/bin/env node
// Auto-cascade watcher for one ticket.
// Polls TicketLine + components every 2s. Whenever a line (or one of its
// BOM components) is updated, fires copy-to-matching from that parent so
// the change propagates to every description-matching sibling on the ticket.
//
// Usage:  node scripts/cascade-watcher.mjs [ticketId]
//         (defaults to the Luton Mosque ticket, 36040286-...)
//
// Kill with Ctrl-C / pm2 stop / kill <pid>. Safe to restart anytime.

import pg from "pg";

const TICKET_ID =
  process.argv[2] || "36040286-d7dd-4d4b-870e-9d10a50424d6";
const POLL_MS = 2000;
const BASE = "http://localhost:3000";
const DB_URL =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();

const lastSeen = new Map(); // lineId → ISO updatedAt

async function snapshot() {
  const { rows } = await db.query(
    `SELECT tl.id, tl."updatedAt", tl."parentLineId",
            COALESCE(parent."isLocked", tl."isLocked") AS parent_locked
     FROM "TicketLine" tl
     LEFT JOIN "TicketLine" parent ON parent.id = tl."parentLineId"
     WHERE tl."ticketId" = $1 OR parent."ticketId" = $1`,
    [TICKET_ID],
  );
  return rows;
}

async function tick() {
  let rows;
  try {
    rows = await snapshot();
  } catch (e) {
    console.log(`[watch] DB error: ${e.message}`);
    return;
  }

  // Prime cache on first tick — no cascade.
  if (lastSeen.size === 0) {
    for (const r of rows) lastSeen.set(r.id, r.updatedAt.toISOString());
    console.log(`[watch] primed ${rows.length} lines on ${TICKET_ID.slice(0, 8)}`);
    return;
  }

  // Find changed lines.
  const changed = [];
  for (const r of rows) {
    const last = lastSeen.get(r.id);
    const cur = r.updatedAt.toISOString();
    if (!last || last !== cur) changed.push(r);
  }
  if (changed.length === 0) return;

  // Resolve each change to its parent (cascade source).
  // Skip changes whose parent line is locked — locked = "leave alone".
  const parents = new Set();
  for (const c of changed) {
    if (c.parent_locked) continue;
    parents.add(c.parentLineId || c.id);
  }

  for (const pid of parents) {
    try {
      const res = await fetch(
        `${BASE}/api/ticket-lines/${pid}/copy-to-matching`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const j = await res.json().catch(() => ({}));
      const ts = new Date().toLocaleTimeString("en-GB");
      console.log(
        `[${ts}] cascade ${pid.slice(0, 8)} → ${j.updated ?? "?"} sibling(s) | ${
          (j.description || "").slice(0, 50)
        }`,
      );
    } catch (e) {
      console.log(`[watch] cascade FAILED for ${pid.slice(0, 8)}: ${e.message}`);
    }
  }

  // Re-snapshot AFTER cascade so cascade-induced bumps don't re-trigger.
  try {
    const after = await snapshot();
    for (const r of after) lastSeen.set(r.id, r.updatedAt.toISOString());
  } catch (e) {
    console.log(`[watch] post-cascade refresh failed: ${e.message}`);
  }
}

console.log(
  `[watch] polling ticket ${TICKET_ID} every ${POLL_MS / 1000}s — Ctrl-C to stop`,
);
await tick();
setInterval(tick, POLL_MS);
