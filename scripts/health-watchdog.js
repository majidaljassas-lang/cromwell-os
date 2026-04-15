// Watchdog — hits /api/health every 5 minutes. If the engine reports unhealthy
// (lastSyncAt is stale) the watchdog kicks the poller via pm2 restart.
//
// Logs all checks so you can see continuous heartbeats in pm2 logs cromwell-watchdog.
const { exec } = require("child_process");
const BASE = "http://localhost:3000";
const INTERVAL_MS = 5 * 60 * 1000;
const STALE_MIN = 15;

function pmRestart(name) {
  return new Promise((resolve) => {
    exec(`pm2 restart ${name}`, (err, stdout, stderr) => {
      if (err) console.log(`[watchdog] pm2 restart ${name} FAILED: ${stderr || err.message}`);
      else console.log(`[watchdog] pm2 restart ${name} OK`);
      resolve();
    });
  });
}

async function check() {
  const ts = new Date().toLocaleTimeString("en-GB");
  try {
    const r = await fetch(`${BASE}/api/health?staleMinutes=${STALE_MIN}`);
    const j = await r.json();
    if (j.ok) {
      const livenessCheck = (j.checks || []).find((c) => c.name === "poller_liveness");
      console.log(`[${ts}] healthy — ${livenessCheck?.detail || ""}`);
      return;
    }
    console.log(`[${ts}] UNHEALTHY: ${(j.checks || []).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join(" | ")}`);
    // If poller is the failing check, kick it
    if ((j.checks || []).some((c) => c.name === "poller_liveness" && !c.ok)) {
      console.log(`[${ts}] kicking cromwell-poller…`);
      await pmRestart("cromwell-poller");
    }
  } catch (e) {
    console.log(`[${ts}] watchdog probe failed: ${e.message}`);
  }
}

console.log(`[watchdog] starting — checks every ${INTERVAL_MS / 60000} min, stale threshold ${STALE_MIN} min`);
check();
setInterval(check, INTERVAL_MS);
