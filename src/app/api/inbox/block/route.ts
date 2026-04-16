/**
 * GET    /api/inbox/block         — list all blocked senders/chats
 * POST   /api/inbox/block         — add a block rule
 * DELETE /api/inbox/block         — remove a block rule
 *
 * Block rules are stored in whatsapp-filter.json (WhatsApp) and
 * a new email-filter.json (email). Both checked at ingest time.
 */

import fs from "fs";
import path from "path";

type FilterEntry = {
  type: "BLACKLIST";
  matchType: "CHAT_ID" | "CHAT_NAME" | "PHONE" | "EMAIL" | "EMAIL_DOMAIN";
  value: string;
  label?: string;
  blockedAt?: string;
};

const WA_FILTER = path.join(process.cwd(), "whatsapp-filter.json");
const EMAIL_FILTER = path.join(process.cwd(), "email-filter.json");

function readFilters(file: string): FilterEntry[] {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch { return []; }
}

function writeFilters(file: string, filters: FilterEntry[]) {
  fs.writeFileSync(file, JSON.stringify(filters, null, 2));
}

export async function GET() {
  const wa = readFilters(WA_FILTER);
  const email = readFilters(EMAIL_FILTER);
  return Response.json({ whatsapp: wa, email, total: wa.length + email.length });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { matchType, value, label } = body as { matchType: string; value: string; label?: string };

  if (!matchType || !value) {
    return Response.json({ error: "matchType and value required" }, { status: 400 });
  }

  const entry: FilterEntry = {
    type: "BLACKLIST",
    matchType: matchType as FilterEntry["matchType"],
    value: value.trim(),
    label: label || undefined,
    blockedAt: new Date().toISOString(),
  };

  if (matchType === "EMAIL" || matchType === "EMAIL_DOMAIN") {
    const filters = readFilters(EMAIL_FILTER);
    if (!filters.some((f) => f.matchType === matchType && f.value === entry.value)) {
      filters.push(entry);
      writeFilters(EMAIL_FILTER, filters);
    }
  } else {
    const filters = readFilters(WA_FILTER);
    if (!filters.some((f) => f.matchType === matchType && f.value === entry.value)) {
      filters.push(entry);
      writeFilters(WA_FILTER, filters);
    }
  }

  return Response.json({ ok: true, entry });
}

export async function DELETE(request: Request) {
  const body = await request.json();
  const { matchType, value } = body as { matchType: string; value: string };

  if (matchType === "EMAIL" || matchType === "EMAIL_DOMAIN") {
    const filters = readFilters(EMAIL_FILTER).filter((f) => !(f.matchType === matchType && f.value === value));
    writeFilters(EMAIL_FILTER, filters);
  } else {
    const filters = readFilters(WA_FILTER).filter((f) => !(f.matchType === matchType && f.value === value));
    writeFilters(WA_FILTER, filters);
  }

  return Response.json({ ok: true });
}
