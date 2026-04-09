import { prisma } from "@/lib/prisma";

/**
 * Intelligent work/personal classifier.
 * Uses rules + learns from user actions (dismiss = personal, convert = work).
 *
 * Works for both WhatsApp and Email.
 */

// Work-related keywords — materials, plumbing, construction, business
const WORK_KEYWORDS = [
  // Materials & products
  "copper", "pipe", "boiler", "valve", "fitting", "radiator", "cylinder",
  "pump", "flue", "filter", "solder", "flux", "tee", "elbow", "coupling",
  "isolator", "thermostat", "expansion", "vessel", "unvented", "pressfit",
  "hep2o", "speedfit", "worcester", "vaillant", "gledhill", "grundfos",
  "fernox", "megaflo", "baxi", "ideal", "potterton",
  // Business terms
  "invoice", "quote", "quotation", "purchase order", "po number", "delivery",
  "price", "pricing", "cost", "margin", "payment", "credit", "refund",
  "order", "supply", "supplier", "merchant", "stock", "return",
  "site", "install", "first fix", "second fix", "commission",
  // Company/trade terms
  "plumbing", "plumber", "heating", "gas", "mechanical", "electrical",
  "contractor", "subcontractor", "client", "customer", "project",
  "cromwell", "wolseley", "selco", "plumb center", "city plumbing",
  "travis perkins", "toolstation", "screwfix",
  // Communication patterns
  "can you price", "how much", "need a quote", "urgent", "asap",
  "send to site", "deliver to", "what's the eta", "acknowledgement",
  "confirmation", "approved", "go ahead", "proceed",
];

// Personal patterns — things that are clearly not work
const PERSONAL_PATTERNS = [
  /^(hi|hey|hello|yo|sup)\s*$/i,
  /\b(love you|miss you|dinner|lunch|food|gym|football|movie|weekend plan)\b/i,
  /\b(mum|dad|bro|sis|babe|habibi|habibti|wifey|hubby)\b/i,
  /\b(birthday|party|wedding|holiday|vacation)\b/i,
  /^(ok|okay|k|lol|haha|😂|👍|❤️|🙏)\s*$/i,
  /^.{0,5}$/,  // Very short messages (< 5 chars) are likely personal
];

// Work-related chat/group name patterns
const WORK_CHAT_PATTERNS = [
  /plumb/i, /heating/i, /cromwell/i, /delivery|deliveries/i,
  /site/i, /project/i, /install/i, /team/i, /office/i,
  /supplier/i, /merchant/i, /order/i, /work/i,
];

interface ClassifyInput {
  isKnownContact: boolean;
  isGroup: boolean;
  chatName: string;
  senderName: string;
  messageText: string;
  isSent: boolean;
  senderPhone?: string;
  senderEmail?: string;
}

interface ClassifyResult {
  isWork: boolean;
  confidence: number; // 0-100
  reason: string;
}

export function classifyWorkPersonal(input: ClassifyInput): ClassifyResult {
  let score = 50; // Start neutral
  const reasons: string[] = [];

  // Known contact in system = strong work signal
  if (input.isKnownContact) {
    score += 30;
    reasons.push("known_contact");
  }

  // Work group chat name
  if (input.isGroup && WORK_CHAT_PATTERNS.some((p) => p.test(input.chatName))) {
    score += 25;
    reasons.push("work_group_name");
  }

  // Check message text for work keywords
  const textLower = input.messageText.toLowerCase();
  const workKeywordHits = WORK_KEYWORDS.filter((kw) => textLower.includes(kw));
  if (workKeywordHits.length > 0) {
    score += Math.min(workKeywordHits.length * 10, 30);
    reasons.push(`work_keywords:${workKeywordHits.length}`);
  }

  // Check for personal patterns
  const personalMatch = PERSONAL_PATTERNS.some((p) => p.test(input.messageText));
  if (personalMatch && workKeywordHits.length === 0) {
    score -= 30;
    reasons.push("personal_pattern");
  }

  // Sent messages — if you sent it, it's more likely work (you initiate work comms)
  // But also you send personal messages, so only slight boost
  if (input.isSent && workKeywordHits.length > 0) {
    score += 5;
  }

  // Very short messages with no work keywords are likely personal
  if (input.messageText.length < 10 && workKeywordHits.length === 0) {
    score -= 15;
    reasons.push("short_no_keywords");
  }

  // Numbers that look like prices or quantities = work
  if (/£\d|(\d+)\s*(ea|m|pack|length|no\.|x\s)/i.test(input.messageText)) {
    score += 20;
    reasons.push("price_or_qty");
  }

  // Phone numbers or addresses = likely work
  if (/\b[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}\b/.test(input.messageText)) {
    score += 15;
    reasons.push("postcode");
  }

  const isWork = score >= 50;
  const confidence = Math.min(Math.max(score, 0), 100);

  return { isWork, confidence, reason: reasons.join(",") };
}

/**
 * Learn from user actions — when user dismisses/converts, record the pattern.
 * Called from inbox action endpoint.
 */
export async function learnFromAction(action: "convert" | "dismiss", senderPhone?: string, senderEmail?: string, chatName?: string) {
  if (!senderPhone && !senderEmail) return;

  // If user converts to ticket → mark sender as work contact
  if (action === "convert") {
    // Check if contact exists, if not create one
    if (senderPhone) {
      const existing = await prisma.contact.findFirst({
        where: { phone: { contains: senderPhone.slice(-7) } },
      });
      if (!existing) {
        await prisma.contact.create({
          data: {
            fullName: chatName || senderPhone,
            phone: senderPhone,
            notes: "Auto-created from inbox conversion",
          },
        });
      }
    }
  }

  // Dismiss = we don't create contacts (they stay unknown = personal)
  // The system naturally learns: known contacts = work, unknown = personal
}
