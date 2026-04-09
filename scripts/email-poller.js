// Email poller + automation runner — runs every 10 minutes
// Syncs emails, generates tasks, builds evidence
const BASE = "http://localhost:3000";

async function poll() {
  const now = new Date().toLocaleTimeString("en-GB");
  try {
    // Sync emails (no auto-link)
    await fetch(`${BASE}/api/automation/sync/outlook`, { method: "POST" });

    // Auto-progress tickets
    await fetch(`${BASE}/api/automation/auto-progress`, { method: "POST" });

    // Generate/close tasks based on ticket state
    await fetch(`${BASE}/api/automation/generate-tasks`, { method: "POST" });

    // Build evidence from events and linked items
    await fetch(`${BASE}/api/automation/build-evidence`, { method: "POST" });

    console.log(`[${now}] Poll complete`);
  } catch (e) {
    console.log(`[${now}] Poll error: ${e.message}`);
  }
}

// Run immediately, then every 10 minutes
poll();
setInterval(poll, 10 * 60 * 1000);

console.log("Poller started — sync + tasks + evidence every 10 minutes");
