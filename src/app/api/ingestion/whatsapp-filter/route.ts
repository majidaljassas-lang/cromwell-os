import { prisma } from "@/lib/prisma";

/**
 * WhatsApp contact filter — manage which chats/contacts are work vs personal.
 *
 * GET  — list all filters
 * POST — add a filter (whitelist or blacklist a chat/phone)
 * DELETE — remove a filter
 *
 * Stored in a simple JSON file since it's configuration, not data.
 */

import fs from "fs";
import path from "path";

const FILTER_FILE = path.join(process.cwd(), "whatsapp-filter.json");

type FilterEntry = {
  id: string;
  type: "WHITELIST" | "BLACKLIST";
  matchType: "PHONE" | "CHAT_NAME" | "CHAT_ID";
  value: string;
  label: string;
  createdAt: string;
};

function loadFilters(): FilterEntry[] {
  try {
    return JSON.parse(fs.readFileSync(FILTER_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveFilters(filters: FilterEntry[]) {
  fs.writeFileSync(FILTER_FILE, JSON.stringify(filters, null, 2));
}

export async function GET() {
  return Response.json(loadFilters());
}

export async function POST(request: Request) {
  const body = await request.json();
  const filters = loadFilters();
  const entry: FilterEntry = {
    id: crypto.randomUUID(),
    type: body.type || "BLACKLIST",
    matchType: body.matchType || "CHAT_NAME",
    value: body.value,
    label: body.label || body.value,
    createdAt: new Date().toISOString(),
  };
  filters.push(entry);
  saveFilters(filters);
  return Response.json(entry, { status: 201 });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const filters = loadFilters().filter((f) => f.id !== id);
  saveFilters(filters);
  return Response.json({ deleted: true });
}
