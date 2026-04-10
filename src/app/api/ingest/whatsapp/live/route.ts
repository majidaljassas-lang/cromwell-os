import { prisma } from "@/lib/prisma";
import { classifyMessage } from "@/lib/ingestion/classifier";
import { resolveLink } from "@/lib/ingestion/link-resolver";
import { classifyWorkPersonal } from "@/lib/ingestion/work-classifier";
import fs from "fs";
import path from "path";

type FilterEntry = { type: "WHITELIST" | "BLACKLIST"; matchType: string; value: string };

function loadFilters(): FilterEntry[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "whatsapp-filter.json"), "utf-8"));
  } catch { return []; }
}

function isBlacklisted(msg: { sender_phone: string; chat_name: string; chat_id: string }): boolean {
  const filters = loadFilters();
  const blacklist = filters.filter((f) => f.type === "BLACKLIST");
  const whitelist = filters.filter((f) => f.type === "WHITELIST");

  // If whitelists exist, ONLY allow whitelisted
  if (whitelist.length > 0) {
    const isWhitelisted = whitelist.some((f) => {
      if (f.matchType === "PHONE") return msg.sender_phone.includes(f.value);
      if (f.matchType === "CHAT_NAME") return msg.chat_name.toLowerCase().includes(f.value.toLowerCase());
      if (f.matchType === "CHAT_ID") return msg.chat_id === f.value;
      return false;
    });
    return !isWhitelisted;
  }

  // Otherwise, check blacklist
  return blacklist.some((f) => {
    if (f.matchType === "PHONE") return msg.sender_phone.includes(f.value);
    if (f.matchType === "CHAT_NAME") return msg.chat_name.toLowerCase().includes(f.value.toLowerCase());
    if (f.matchType === "CHAT_ID") return msg.chat_id === f.value;
    return false;
  });
}

/**
 * POST /api/ingest/whatsapp/live
 *
 * Receives individual WhatsApp messages from the listener script.
 * Filters for work-related messages only (known contacts, business groups,
 * or messages containing work keywords).
 */

// Known business keywords that indicate a work message
const WORK_KEYWORDS = [
  /plumb/i, /pipe/i, /copper/i, /valve/i, /fitting/i, /boiler/i,
  /site/i, /deliver/i, /order/i, /quote/i, /invoice/i, /po\b/i,
  /material/i, /install/i, /job/i, /work/i, /price/i, /cost/i,
  /payment/i, /urgent/i, /customer/i, /supplier/i, /cromwell/i,
  /pressfit/i, /mlcp/i, /radiator/i, /cylinder/i, /cistern/i,
  /£\d/i, /\d+mm/i, /tee\b/i, /elbow/i, /coupler/i, /reducer/i,
];

// Groups that are always work-related (add group names here)
const WORK_GROUPS = [
  /cromwell/i, /plumb/i, /work/i, /site/i, /team/i, /trade/i,
  /supplier/i, /order/i,
];

// Group-chat keywords that should auto-dismiss (football/sports noise).
// Matched case-insensitively as substrings against the chat/group name only —
// never against 1:1 chats.
const IGNORED_GROUP_KEYWORDS = [
  "football", "fc ", " fc", "premier league", "champions league",
  "fantasy football", "ronaldo", "messi", "arsenal", "chelsea",
  "liverpool", "man city", "man utd", "tottenham", "spurs",
  "wba", "fixtures", "matchday", "el clasico", "world cup",
];

function isIgnoredGroup(chatName: string, isGroup: boolean): boolean {
  if (!isGroup) return false;
  if (!chatName) return false;
  const lower = chatName.toLowerCase();
  return IGNORED_GROUP_KEYWORDS.some((kw) => lower.includes(kw));
}

function isWorkRelated(msg: {
  message_text: string;
  chat_name: string;
  is_group: boolean;
  sender_phone: string;
}): boolean {
  // Check if it's a known work group
  if (msg.is_group && WORK_GROUPS.some((r) => r.test(msg.chat_name))) return true;

  // Check message content for work keywords
  if (WORK_KEYWORDS.some((r) => r.test(msg.message_text))) return true;

  // Check chat name for work indicators
  if (WORK_KEYWORDS.some((r) => r.test(msg.chat_name))) return true;

  return false;
}

export async function POST(request: Request) {
  try {
    const msg = await request.json();

    // Skip if before April 1st
    const msgDate = new Date(msg.timestamp);
    if (msgDate < new Date("2026-04-01")) {
      return Response.json({ skipped: true, reason: "before_cutoff" });
    }

    // Strip WhatsApp suffixes from phone number (@lid, @c.us, etc.)
    const cleanPhone = (msg.sender_phone || "").replace(/@.+$/, "").replace(/^\+/, "").slice(-10);

    // Check if sender is a known contact in the system
    const knownContact = cleanPhone.length >= 7
      ? await prisma.contact.findFirst({
          where: { phone: { contains: cleanPhone } },
        })
      : null;

    const isKnown = !!knownContact;
    const isWork = isKnown || isWorkRelated(msg);

    // Check blacklist/whitelist
    if (isBlacklisted({ sender_phone: msg.sender_phone || "", chat_name: msg.chat_name || "", chat_id: msg.chat_id || "" })) {
      return Response.json({ skipped: true, reason: "filtered" });
    }

    // Capture everything — classify as WORK/PERSONAL in the event for inbox filtering
    // (Previously filtered personal messages — now relaxed so user can triage from inbox)

    // Deduplicate
    const existing = await prisma.ingestionEvent.findFirst({
      where: { externalMessageId: msg.message_id },
    });
    if (existing) {
      return Response.json({ skipped: true, reason: "duplicate" });
    }

    // Get or create WhatsApp source
    let source = await prisma.ingestionSource.findFirst({
      where: { sourceType: "WHATSAPP" },
    });
    if (!source) {
      source = await prisma.ingestionSource.create({
        data: {
          sourceType: "WHATSAPP",
          externalRef: "personal-whatsapp",
          displayName: "WhatsApp",
          isActive: true,
          status: "ACTIVE",
        },
      });
    }

    // Football / sports group auto-dismiss (keep audit trail, don't skip).
    const ignoredByKeyword = isIgnoredGroup(msg.chat_name || "", !!msg.is_group);
    const eventRawPayload = ignoredByKeyword
      ? { ...msg, _filteredReason: "football_keyword" }
      : msg;

    // Create ingestion event
    const event = await prisma.ingestionEvent.create({
      data: {
        sourceId: source.id,
        externalMessageId: msg.message_id,
        sourceRecordType: "WHATSAPP",
        eventKind: msg.is_sent ? "WHATSAPP_SENT" : "WHATSAPP_MESSAGE",
        rawPayload: eventRawPayload,
        receivedAt: msgDate,
        status: ignoredByKeyword ? "DISMISSED" : "PARSED",
      },
    });

    // Create parsed message
    await prisma.parsedMessage.create({
      data: {
        ingestionEventId: event.id,
        messageType: "WHATSAPP",
        extractedText: `${msg.is_sent ? "[SENT] " : ""}${msg.chat_name || msg.sender_name}: ${msg.message_text}`,
        structuredData: {
          chatId: msg.chat_id,
          chatName: msg.chat_name,
          senderPhone: msg.sender_phone,
          senderName: msg.sender_name,
          isGroup: msg.is_group,
          isSent: msg.is_sent,
          hasMedia: msg.has_media,
          mediaType: msg.media_type,
        },
      },
    });

    // Classify the message
    const classification = classifyMessage(msg.message_text || "");

    // Intelligent work/personal classification
    const workSignal = classifyWorkPersonal({
      isKnownContact: isKnown,
      isGroup: msg.is_group,
      chatName: msg.chat_name || "",
      senderName: msg.sender_name || "",
      messageText: msg.message_text || "",
      isSent: msg.is_sent,
    });

    // Update event with classification (preserve DISMISSED status for filtered groups)
    await prisma.ingestionEvent.update({
      where: { id: event.id },
      data: {
        eventKind: workSignal.isWork ? (msg.is_sent ? "WHATSAPP_SENT" : classification.classification) : "PERSONAL",
        status: ignoredByKeyword ? "DISMISSED" : "CLASSIFIED",
      },
    });

    // NOTE: Auto-linking DISABLED — everything lands in inbox for manual triage
    try {
      await prisma.inboundEvent.create({
        data: {
          eventType: "WHATSAPP_MESSAGE",
          sourceType: "WHATSAPP",
          externalRef: msg.message_id,
          sender: msg.sender_name,
          senderPhone: msg.sender_phone,
          receivedAt: msgDate,
          rawText: msg.message_text,
          subject: msg.chat_name || msg.sender_name,
          linkStatus: "UNPROCESSED",
          ingestionEventId: event.id,
        },
      });
    } catch {
      // Inbound event creation failed — continue anyway
    }

    // Update event with classification (preserve DISMISSED status for filtered groups)
    await prisma.ingestionEvent.update({
      where: { id: event.id },
      data: {
        eventKind: msg.is_sent ? "WHATSAPP_SENT" : classification.classification,
        status: ignoredByKeyword ? "DISMISSED" : "CLASSIFIED",
      },
    });

    return Response.json({
      ok: true,
      eventId: event.id,
      classification: classification.classification,
      confidence: classification.confidence,
    });
  } catch (error) {
    console.error("WhatsApp live ingest failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to ingest" }, { status: 500 });
  }
}
