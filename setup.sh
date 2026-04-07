#!/bin/bash
set -e

echo "=== Cromwell OS — Setup ==="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is required. Install it from https://nodejs.org (v22+ recommended)"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "ERROR: Node.js v20+ required, you have $(node -v)"
  exit 1
fi

echo "✓ Node.js $(node -v)"

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

# Set up .env if missing
if [ ! -f .env ]; then
  echo ""
  echo "Creating .env from .env.example..."
  cp .env.example .env
  echo "✓ .env created"
else
  echo "✓ .env already exists"
fi

# Start Prisma dev server (embedded Postgres)
echo ""
echo "Starting Prisma dev server (embedded Postgres)..."
npx prisma dev &
PRISMA_PID=$!

# Wait for Prisma to be ready
echo "Waiting for database to be ready..."
sleep 8

# Run migrations
echo ""
echo "Applying database migrations..."
npx prisma migrate deploy

# Seed if seed script exists
if grep -q '"seed"' package.json 2>/dev/null; then
  echo "Running database seed..."
  npx prisma db seed
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Prisma dev server running in background (PID: $PRISMA_PID)"
echo ""
echo "To start the app:"
echo "  npm run dev"
echo ""
echo "Then open http://localhost:3000"
echo ""
