#!/bin/bash
# Cromwell OS — Start all background services
# Launched automatically at login via ~/Library/LaunchAgents/com.cromwell.os.plist
# If any critical service dies the script exits non-zero and launchd respawns it.

set -u
cd "$(dirname "$0")/.."

LOG_DIR="./logs"
mkdir -p "$LOG_DIR"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# Load .env so SCHEDULER_SECRET is available for automation curls
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      ''|'#'*) continue ;;
      *)
        value="${value%\"}"
        value="${value#\"}"
        export "$key=$value"
        ;;
    esac
  done < .env
fi

if [ -z "${SCHEDULER_SECRET:-}" ]; then
  log "⚠ SCHEDULER_SECRET not set — /api/automation/* will 401"
fi

log "🔧 Starting Cromwell OS services"

# ── 1. DATABASE ────────────────────────────────────────────────────────────
log "📦 Ensuring Homebrew Postgres 17 is running on :51214"
if ! /usr/sbin/lsof -iTCP:51214 -sTCP:LISTEN >/dev/null 2>&1; then
  /opt/homebrew/bin/brew services start postgresql@17 >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    /usr/sbin/lsof -iTCP:51214 -sTCP:LISTEN >/dev/null 2>&1 && break
    sleep 1
  done
fi
if ! /usr/sbin/lsof -iTCP:51214 -sTCP:LISTEN >/dev/null 2>&1; then
  log "❌ Database did not come up within 30s — aborting so launchd retries"
  exit 1
fi
log "   DB is up"

# ── 2. NEXT.JS WEB SERVER ──────────────────────────────────────────────────
NEXT_PID=""
if ! /usr/sbin/lsof -ti:3000 >/dev/null 2>&1; then
  log "🌐 Starting Next.js dev server on :3000"
  nohup /opt/homebrew/bin/npx next dev --port 3000 > "$LOG_DIR/web.log" 2>&1 &
  NEXT_PID=$!
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo 000)
    if [ "$code" = "200" ] || [ "$code" = "307" ]; then
      log "   Web ready"
      break
    fi
    sleep 1
  done
else
  log "🌐 Web already running on :3000"
fi

# ── 3. WHATSAPP LISTENER ───────────────────────────────────────────────────
if /usr/sbin/lsof -ti:3001 >/dev/null 2>&1; then
  log "📱 Killing orphan WhatsApp listener on :3001"
  # shellcheck disable=SC2046
  kill $(/usr/sbin/lsof -ti:3001) 2>/dev/null || true
  sleep 2
fi
log "📱 Starting WhatsApp listener on :3001"
nohup /opt/homebrew/bin/node scripts/whatsapp-qr-server.js > "$LOG_DIR/whatsapp.log" 2>&1 &
WA_PID=$!

# ── 4. BOOT-TIME CATCH-UP ──────────────────────────────────────────────────
# One-shot: pull anything that arrived while the machine was asleep
(
  sleep 20
  log "🔄 Boot-time catch-up: outlook sync + process"
  curl -s -X POST -H "x-scheduler-secret: ${SCHEDULER_SECRET:-}" \
    http://localhost:3000/api/automation/sync/outlook >/dev/null 2>&1 || true
  curl -s -X POST -H "x-scheduler-secret: ${SCHEDULER_SECRET:-}" \
    http://localhost:3000/api/automation/process >/dev/null 2>&1 || true

  # WhatsApp backfill last 24h, once the listener is connected
  for _ in $(seq 1 60); do
    if curl -s http://localhost:3001 2>/dev/null | grep -q "Connected"; then
      SINCE=$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
        || date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)
      curl -s -X POST -H "Content-Type: application/json" \
        http://localhost:3001/backfill \
        -d "{\"since\":\"$SINCE\"}" >/dev/null 2>&1 || true
      log "   WhatsApp backfill since $SINCE"
      break
    fi
    sleep 5
  done
  log "🔄 Boot-time catch-up complete"
) &
CATCHUP_PID=$!

# ── 5. POLLING ────────────────────────────────────────────────────────────────
# Note: Polling is now handled by cromwell-poller (pm2 process running scripts/email-poller.js)
# every 2 minutes. The old poller loop below has been removed to avoid duplicate polling.
# If you need to restart the poller, run: pm2 restart cromwell-poller

log "✅ All services up — Web :3000, WhatsApp :3001 (polling via cromwell-poller)"

cleanup() {
  log "⏹ Stopping — SIGTERM received"
  kill "$WA_PID" "$CATCHUP_PID" ${NEXT_PID:+"$NEXT_PID"} 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# Watchdog: if WA dies, exit non-zero so launchd respawns everything.
# Note: CATCHUP_PID is a one-shot background job, so we only monitor WA.
while kill -0 "$WA_PID" 2>/dev/null; do
  sleep 30
done

log "⚠ WhatsApp service exited — shutting down so launchd restarts us"
kill "$WA_PID" "$CATCHUP_PID" ${NEXT_PID:+"$NEXT_PID"} 2>/dev/null || true
exit 1
