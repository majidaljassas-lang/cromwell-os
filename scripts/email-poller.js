// Email poller + automation runner — runs every 2 minutes
// 1. Sync Outlook (creates IngestionEvents + IntakeDocuments for bill PDFs/bodies)
// 2. Tick the bills-intake queue (PDF parse → OCR fallback → bill extraction → match → allocate)
// 3. Trickle-down chain (auto-progress, build-evidence, generate-tasks, legacy match-bills)
// 4. Re-match sweep across post-cutover bills (picks up newly-seeded aliases / mappings / corrections)
const BASE = "http://localhost:3000";
const SECRET = process.env.SCHEDULER_SECRET;
const SECRET_HEADERS = SECRET ? { "x-scheduler-secret": SECRET } : {};

if (!SECRET) {
  console.warn(
    "[poller] SCHEDULER_SECRET not set in process env — /api/automation/* calls will 401. Source .env before starting."
  );
}

async function safeJson(res) { try { return await res.json(); } catch { return null; } }

async function poll() {
  const now = new Date().toLocaleTimeString("en-GB");
  try {
    // 0. Enable Banking live sync — pulls latest transactions from Barclays / Barclaycard.
    //    Wrapped with catch so a missing/expired connection never breaks the email pipeline.
    const bankRes = await fetch(`${BASE}/api/enable-banking/sync`, { method: "POST" })
      .catch((e) => { console.log(`[${now}] [bank] skip: ${e.message}`); return null; });
    const bank = bankRes ? ((await safeJson(bankRes)) || {}) : {};
    const bankSummary = bankRes
      ? ` bank[src=${bank.sourcesProcessed ?? 0} acct=${bank.accountsUpserted ?? 0} txn=${bank.transactionsUpserted ?? 0} sugg=${bank.suggestionsCreated ?? 0} reauth=${(bank.reauthRequired ?? []).length}]`
      : " bank[skip]";

    // 1. Sync emails — populates IntakeDocument rows for any bill PDFs / supplier email bodies
    await fetch(`${BASE}/api/automation/sync/outlook`, {
      method: "POST",
      headers: { ...SECRET_HEADERS },
    });

    // 2. Drain the bills-intake queue end-to-end (parse → OCR → extract → match → allocate)
    const tickRes = await fetch(`${BASE}/api/intake/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "tick" }),
    });
    const tick = (await safeJson(tickRes)) || {};

    // 3. Legacy trickle-down chain (auto-progress, build-evidence, generate-tasks, match-bills)
    const trickleRes = await fetch(`${BASE}/api/automation/trickle-down`, {
      method: "POST",
      headers: { ...SECRET_HEADERS },
    });
    const trickle = ((await safeJson(trickleRes)) || {}).summary || {};

    // 4. Re-match sweep — picks up new aliases / corrections seeded since last cycle
    const rematchRes = await fetch(`${BASE}/api/intake/rematch-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const rematch = (await safeJson(rematchRes)) || {};

    const summary =
      bankSummary +
      ` intake[parse=${tick.parsed ?? 0} match=${tick.matched ?? 0} alloc=${tick.allocated ?? 0} err=${tick.errors ?? 0}]` +
      ` legacy[prog=${trickle.autoProgress?.transitionsApplied ?? 0} bills=${trickle.matchBills?.matched ?? 0}]` +
      ` rematch[scan=${rematch.scanned ?? 0} auto=${rematch.autoLinked ?? 0} sugg=${rematch.suggested ?? 0}]`;

    console.log(`[${now}] Poll complete${summary}`);
  } catch (e) {
    console.log(`[${now}] Poll error: ${e.message}`);
  }
}

// Run immediately, then every 2 minutes — bills intake needs near-real-time signal
const INTERVAL_MS = 2 * 60 * 1000;
poll();
setInterval(poll, INTERVAL_MS);

console.log(`Poller started — sync + intake-tick + trickle-down + rematch every ${INTERVAL_MS/60000} minutes (PID ${process.pid})`);
