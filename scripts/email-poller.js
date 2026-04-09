// Email poller — syncs emails and runs background automation every 10 minutes
// NOTE: Auto-linking is DISABLED. Everything lands in inbox for manual triage.
const BASE = "http://localhost:3000";

async function poll() {
  const now = new Date().toLocaleTimeString("en-GB");
  try {
    // Sync emails only (no auto-link, no auto-action)
    await fetch(`${BASE}/api/automation/sync/outlook`, { method: "POST" });

    // Auto-progress tickets that have clear state changes
    await fetch(`${BASE}/api/automation/auto-progress`, { method: "POST" });

    console.log(`[${now}] Poll complete`);
  } catch (e) {
    console.log(`[${now}] Poll error: ${e.message}`);
  }
}

// Run immediately, then every 10 minutes
poll();
setInterval(poll, 10 * 60 * 1000);

console.log("Email poller started — running every 10 minutes");
