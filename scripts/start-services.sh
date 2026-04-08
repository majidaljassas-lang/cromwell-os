#!/bin/bash
# Cromwell OS — Start all background services
# Run: ./scripts/start-services.sh
# To stop: kill the process group or close the terminal

cd "$(dirname "$0")/.."

echo "🔧 Starting Cromwell OS services..."

# 1. Start Prisma dev DB (if not running)
echo "📦 Starting database..."
npx prisma dev &>/dev/null &
sleep 5

# 2. Start Next.js dev server (if not running)
if ! lsof -ti:3000 &>/dev/null; then
  echo "🌐 Starting web server on port 3000..."
  npx next dev --port 3000 &>/dev/null &
  sleep 3
else
  echo "🌐 Web server already running on port 3000"
fi

# 3. Start WhatsApp listener
echo "📱 Starting WhatsApp listener on port 3001..."
node scripts/whatsapp-qr-server.js &
WA_PID=$!

# 4. Start email poller + auto-processor (every 10 mins)
echo "📧 Starting email poller (every 10 mins)..."
(
  while true; do
    curl -s -X POST http://localhost:3000/api/automation/sync/outlook > /dev/null 2>&1
    curl -s -X POST http://localhost:3000/api/automation/process > /dev/null 2>&1
    sleep 600
  done
) &
POLLER_PID=$!

echo ""
echo "✅ All services running:"
echo "   🌐 Web:      http://localhost:3000"
echo "   📱 WhatsApp:  http://localhost:3001 (QR if needed)"
echo "   📧 Email:     polling every 10 mins"
echo "   🔄 Processor: auto-acting on new events"
echo ""
echo "   Press Ctrl+C to stop all services"

# Wait for Ctrl+C
trap "echo '⏹ Stopping...'; kill $WA_PID $POLLER_PID 2>/dev/null; exit 0" INT TERM
wait
