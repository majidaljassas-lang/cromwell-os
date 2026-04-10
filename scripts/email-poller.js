// Email poller + automation runner — runs every 10 minutes
// Syncs emails, then hits the single trickle-down endpoint which runs
// auto-progress, build-evidence, generate-tasks, and match-bills in order.
const BASE = "http://localhost:3000";

async function poll() {
  const now = new Date().toLocaleTimeString("en-GB");
  try {
    // Sync emails (no auto-link)
    await fetch(`${BASE}/api/automation/sync/outlook`, { method: "POST" });

    // Run the full trickle-down chain in one call
    const res = await fetch(`${BASE}/api/automation/trickle-down`, {
      method: "POST",
    });
    let summary = "";
    try {
      const body = await res.json();
      const s = body?.summary || {};
      summary =
        ` progressed=${s.autoProgress?.transitionsApplied ?? 0}` +
        ` evidence=${s.buildEvidence?.evidenceCreated ?? 0}` +
        ` tasks+=${s.generateTasks?.tasksCreated ?? 0}` +
        ` tasks-=${s.generateTasks?.tasksClosed ?? 0}` +
        ` bills=${s.matchBills?.matched ?? 0}`;
    } catch {
      /* ignore */
    }

    console.log(`[${now}] Poll complete${summary}`);
  } catch (e) {
    console.log(`[${now}] Poll error: ${e.message}`);
  }
}

// Run immediately, then every 10 minutes
poll();
setInterval(poll, 10 * 60 * 1000);

console.log("Poller started — sync + trickle-down every 10 minutes");
