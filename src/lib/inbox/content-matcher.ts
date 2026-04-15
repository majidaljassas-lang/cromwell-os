/**
 * Content-aware ticket matcher for inbox threads.
 *
 * Pairs with resolveAutoLink() in thread-builder.ts. Where the contact-walker
 * only knows WHO sent a message, this reads the message itself for signals:
 *
 *   - Ticket number mention    ("Ticket #52", "Ref 52", "Our ref 52")  — very strong
 *   - Ticket title name match  ("Ewa" matches ticket title "Ewa ...")    — medium
 *   - Site name / alias match  ("3 Ferry Lane" matches Site.siteName)    — strong
 *   - Product token match      ("760mm shower tray" vs ticket.line.desc) — medium
 *
 * Scoring:
 *   ticket# alone                                     → HIGH + ticketId
 *   site + product tokens (≥ 1 shared)                → HIGH + ticketId
 *   site alone (mentioned on exactly one open ticket) → MEDIUM + ticketId (surfaced, not linked)
 *   product tokens alone (≥ 2 shared with one ticket) → MEDIUM + ticketId
 *   anything else                                     → LOW, no ticket
 *
 * The result composes with the contact-walker: the caller takes the best of
 * (contact, content) by confidence, preferring a ticketId when both agree.
 */
import { prisma } from "@/lib/prisma";
import { TicketStatus } from "@/generated/prisma";

const CLOSED_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.CLOSED,
  TicketStatus.INVOICED,
  TicketStatus.LOCKED,
];

const STOP = new Set([
  "the","and","for","with","from","that","this","your","our","you","have","been","will",
  "are","was","were","has","had","can","please","thanks","thank","regards","kind",
  "new","old","size","item","per","each","mm","cm","ea","pack","box","x","of","to","in",
  "on","at","by","is","as","an","a","be","it","or","me","we","us","if","so","no","yes",
  "order","invoice","delivery","bill","statement",
]);

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenise(s: string): Set<string> {
  if (!s) return new Set();
  const out = new Set<string>();
  for (const w of normalise(s).split(" ")) {
    if (w.length >= 3 && !STOP.has(w)) out.add(w);
  }
  return out;
}

// Product-code shape: e.g. A4131AA, TX4011, HD5/15W, WS08W — starts with a letter, has a digit, 4-12 chars
const SKU_REGEX = /\b([A-Z][A-Z0-9./-]{3,11})\b/g;
function extractSkus(text: string): Set<string> {
  if (!text) return new Set();
  const out = new Set<string>();
  let m;
  const upper = text.toUpperCase();
  while ((m = SKU_REGEX.exec(upper)) !== null) {
    const c = m[1];
    if (/\d/.test(c) && c.length >= 4 && c.length <= 12) out.add(c);
  }
  return out;
}

// Dimension shape: "760mm", "1600 x 800", "22mm x 3m" — strong disambiguators for plumbing/building items
const DIM_REGEX = /\b(\d{2,4})\s*(?:mm|cm|m\b)/gi;
function extractDimensions(text: string): Set<string> {
  if (!text) return new Set();
  const out = new Set<string>();
  let m;
  while ((m = DIM_REGEX.exec(text)) !== null) {
    out.add(`${m[1]}mm`);
  }
  return out;
}

// Ticket-number regexes — "#52", "ticket 52", "our ref 52", "ref: 52", "job 52"
const TICKET_NUM_REGEXES: RegExp[] = [
  /#\s*(\d{1,6})\b/,
  /ticket[\s#:]*(\d{1,6})\b/i,
  /(?:our\s+)?ref(?:erence)?[:\s#]*(\d{1,6})\b/i,
  /job[\s#:]*(\d{1,6})\b/i,
];

export interface ContentLinkResult {
  confidence: "HIGH" | "MEDIUM" | "LOW";
  ticketId: string | null;
  reasons: string[];
  candidateCount: number;
}

export async function resolveContentLink(
  text: string,
  customerId?: string | null,
): Promise<ContentLinkResult> {
  const reasons: string[] = [];
  if (!text || text.trim().length < 4) {
    return { confidence: "LOW", ticketId: null, reasons: ["empty content"], candidateCount: 0 };
  }

  // ── 1. Ticket number mention — strongest signal ──────────────────────────
  for (const re of TICKET_NUM_REGEXES) {
    const m = text.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    const t = await prisma.ticket.findFirst({
      where: { ticketNo: n, status: { notIn: CLOSED_TICKET_STATUSES } },
      select: { id: true },
    });
    if (t) {
      reasons.push(`ticket number #${n} mentioned in content`);
      return { confidence: "HIGH", ticketId: t.id, reasons, candidateCount: 1 };
    }
  }

  // ── 2. Pull candidate open tickets ──────────────────────────────────────
  // Bound this — matching against every open ticket is fine, but we select
  // the minimum fields we need for scoring.
  const candidates = await prisma.ticket.findMany({
    where: {
      status: { notIn: CLOSED_TICKET_STATUSES },
      ...(customerId ? { payingCustomerId: customerId } : {}),
    },
    select: {
      id: true,
      ticketNo: true,
      title: true,
      payingCustomerId: true,
      payingCustomer: { select: { name: true } },
      site: { select: { id: true, siteName: true, aliases: true } },
      lines: { select: { description: true } },
    },
    take: 500,
  });
  if (candidates.length === 0) {
    reasons.push("no open tickets");
    return { confidence: "LOW", ticketId: null, reasons, candidateCount: 0 };
  }

  const lowerText = text.toLowerCase();
  const textTokens = tokenise(text);
  const textSkus = extractSkus(text);
  const textDims = extractDimensions(text);

  // ── 3. Score each candidate ──────────────────────────────────────────────
  type Scored = {
    ticketId: string;
    ticketNo: number;
    score: number;
    signals: string[];
    siteMatch: boolean;
    skuMatch: boolean;
    dimMatch: boolean;
    productTokenShared: number;
    titleNameMatch: boolean;
  };
  const scored: Scored[] = [];
  for (const c of candidates) {
    const signals: string[] = [];
    let score = 0;

    // Site name + aliases
    let siteMatch = false;
    if (c.site?.siteName) {
      const siteLower = c.site.siteName.toLowerCase();
      if (siteLower.length >= 4 && lowerText.includes(siteLower)) {
        score += 50;
        siteMatch = true;
        signals.push(`site: "${c.site.siteName}"`);
      } else if (c.site.aliases && c.site.aliases.length) {
        for (const alias of c.site.aliases) {
          if (alias && alias.length >= 4 && lowerText.includes(alias.toLowerCase())) {
            score += 45;
            siteMatch = true;
            signals.push(`site alias: "${alias}"`);
            break;
          }
        }
      }
    }

    // Title name tokens (e.g. "Ewa" in ticket title "Ewa - 31.03 - 3 Ferry Lane")
    let titleNameMatch = false;
    const titleTokens = tokenise(c.title ?? "");
    let sharedTitleTokens = 0;
    for (const t of titleTokens) {
      // Prefer proper-noun-ish tokens: 3-20 chars, not in stop set, and at least 1 uppercase char in original
      if (t.length < 3) continue;
      if (textTokens.has(t)) sharedTitleTokens++;
    }
    if (sharedTitleTokens >= 2) {
      score += 20;
      titleNameMatch = true;
      signals.push(`${sharedTitleTokens} title tokens shared`);
    } else if (sharedTitleTokens === 1 && titleTokens.size <= 4) {
      score += 10;
      titleNameMatch = true;
      signals.push(`1 distinctive title token shared`);
    }

    // Product tokens from ticket lines
    const lineText = (c.lines ?? []).map((l) => l.description).join(" ");
    const lineTokens = tokenise(lineText);
    const lineSkus   = extractSkus(lineText);
    const lineDims   = extractDimensions(lineText);

    let skuMatch = false;
    for (const s of textSkus) {
      if (lineSkus.has(s)) { skuMatch = true; signals.push(`SKU match: ${s}`); score += 60; break; }
    }
    let dimMatch = false;
    for (const d of textDims) {
      if (lineDims.has(d)) { dimMatch = true; signals.push(`dimension match: ${d}`); score += 25; break; }
    }
    let productTokenShared = 0;
    for (const t of textTokens) if (lineTokens.has(t)) productTokenShared++;
    if (productTokenShared >= 3) { score += 20; signals.push(`${productTokenShared} product tokens shared`); }
    else if (productTokenShared === 2) { score += 10; signals.push(`${productTokenShared} product tokens shared`); }

    if (score > 0) {
      scored.push({
        ticketId: c.id, ticketNo: c.ticketNo, score, signals,
        siteMatch, skuMatch, dimMatch, productTokenShared, titleNameMatch,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { confidence: "LOW", ticketId: null, reasons: ["no content matches"], candidateCount: 0 };

  const top = scored[0];
  reasons.push(...top.signals);

  // ── 4. Derive confidence from the composition of signals ────────────────
  //   site + (sku | dim | productTokens>=1) → HIGH
  //   sku alone                             → HIGH
  //   site alone                            → MEDIUM (surfaced, not linked unless unique)
  //   title + productTokens                 → MEDIUM
  //   anything else                         → LOW
  const secondScore = scored[1]?.score ?? 0;
  const dominant = top.score - secondScore >= 25 || scored.length === 1;

  let confidence: ContentLinkResult["confidence"] = "LOW";
  if (top.skuMatch) confidence = "HIGH";
  else if (top.siteMatch && (top.dimMatch || top.productTokenShared >= 1)) confidence = "HIGH";
  else if (top.siteMatch) confidence = dominant ? "MEDIUM" : "LOW";
  else if (top.titleNameMatch && top.productTokenShared >= 2) confidence = "MEDIUM";
  else if (top.productTokenShared >= 3 && dominant) confidence = "MEDIUM";

  // Only return a ticketId when we're confident enough AND the top candidate is distinctively ahead
  const ticketId = confidence === "LOW" ? null : (dominant ? top.ticketId : null);
  if (!dominant && confidence !== "LOW") {
    reasons.push(`ambiguous — top 2 scores too close (${top.score} vs ${secondScore})`);
  }

  reasons.push(`candidate ticket #${top.ticketNo} (score ${top.score})`);
  return { confidence, ticketId, reasons, candidateCount: scored.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — Attachment-aware async rescore
//
// When IntakeDocument.status flips to PARSED (pdf-parser / ocr-runner), we
// get a new body of text: the extracted PDF/OCR content. This re-runs scoring
// over the union (email subject + body + every attachment's rawText), layers
// in two extra signal types (PO numbers + supplier names), and upgrades the
// thread's linkConfidence if the new score is stronger. Every upgrade writes
// an IngestionAuditLog row explaining exactly which signal fired.
// ═══════════════════════════════════════════════════════════════════════════

const PO_REGEXES: RegExp[] = [
  /\bP\.?O\.?[-\s#:]*([A-Z0-9][A-Z0-9\-\/]{2,14})\b/gi,
  /\b(?:purchase\s*order|order\s*(?:no|number|ref|reference))[-\s#:]*([A-Z0-9][A-Z0-9\-\/]{2,14})\b/gi,
];

function extractPoNumbers(text: string): Set<string> {
  if (!text) return new Set();
  const out = new Set<string>();
  for (const re of PO_REGEXES) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const v = (m[1] ?? "").toUpperCase().trim();
      if (v.length >= 3 && /[0-9]/.test(v)) out.add(v);
    }
  }
  return out;
}

async function loadAttachmentText(ingestionEventIds: string[]): Promise<string> {
  if (ingestionEventIds.length === 0) return "";
  const docs = await prisma.intakeDocument.findMany({
    where: {
      ingestionEventId: { in: ingestionEventIds },
      status: { in: ["PARSED", "MATCH_PENDING", "AUTO_MATCHED", "REVIEW_REQUIRED", "APPROVED", "POSTED"] },
      rawText: { not: null },
    },
    select: { id: true, rawText: true },
  });
  return docs.map((d) => d.rawText ?? "").join("\n\n");
}

async function scanPoNumbers(poNos: Set<string>): Promise<{
  customerPO?: { id: string; poNo: string; customerId: string | null; ticketId: string | null };
  procurementOrder?: { id: string; poNo: string; supplierId: string | null; ticketId: string | null };
}> {
  if (poNos.size === 0) return {};
  const list = [...poNos];
  const [cpo, pro] = await Promise.all([
    prisma.customerPO.findFirst({ where: { poNo: { in: list } }, select: { id: true, poNo: true, customerId: true, ticketId: true } }),
    prisma.procurementOrder.findFirst({ where: { poNo: { in: list } }, select: { id: true, poNo: true, supplierId: true, ticketId: true } }),
  ]);
  return { customerPO: cpo ?? undefined, procurementOrder: pro ?? undefined };
}

async function scanSupplierNames(text: string): Promise<{ supplierId: string; name: string; hit: string } | null> {
  if (!text) return null;
  const lower = text.toLowerCase();
  const suppliers = await prisma.supplier.findMany({
    select: { id: true, name: true, aliases: { select: { alias: true } } },
  });
  for (const s of suppliers) {
    if (s.name && s.name.length >= 4 && lower.includes(s.name.toLowerCase())) {
      return { supplierId: s.id, name: s.name, hit: s.name };
    }
    for (const a of s.aliases ?? []) {
      if (a.alias && a.alias.length >= 4 && lower.includes(a.alias.toLowerCase())) {
        return { supplierId: s.id, name: s.name, hit: a.alias };
      }
    }
  }
  return null;
}

export interface AttachmentAwareResult extends ContentLinkResult {
  /** Every distinct signal that fired, in the order they were detected. */
  signals: Array<{ kind: string; detail: string; weight: number }>;
  /** IDs of anything the attachments hit (for cross-link UI later). */
  matchedCustomerPOId?: string;
  matchedProcurementOrderId?: string;
  matchedSupplierId?: string;
  /** Union of scanned text length — useful for "n chars parsed" UI breadcrumb */
  textLength: number;
}

/**
 * Score a thread using BOTH its email content AND any parsed attachment text.
 * Called synchronously on thread build (attachmentText = "") AND asynchronously
 * when a PDF/OCR parse completes (attachmentText = combined rawText from docs).
 */
export async function resolveContentLinkWithAttachments(
  opts: {
    subject: string | null;
    body: string | null;
    attachmentText: string;
    customerId?: string | null;
  },
): Promise<AttachmentAwareResult> {
  const combined = [opts.subject, opts.body, opts.attachmentText].filter(Boolean).join("\n\n");
  const base = await resolveContentLink(combined, opts.customerId ?? null);

  const signals: AttachmentAwareResult[`signals`] = [];
  // Propagate base reasons as signals so the audit trail is unified
  for (const r of base.reasons) signals.push({ kind: "content", detail: r, weight: 0 });

  // PO number signal — only check when we actually have attachment text
  // (POs in email body alone are usually already covered by subject/body in base scoring)
  const poText = opts.attachmentText || combined;
  const poNos = extractPoNumbers(poText);
  let customerPOId: string | undefined;
  let procurementOrderId: string | undefined;
  let ticketFromPo: string | null = null;
  if (poNos.size > 0) {
    const { customerPO, procurementOrder } = await scanPoNumbers(poNos);
    if (customerPO) {
      signals.push({ kind: "customer_po", detail: `PO ${customerPO.poNo} → CustomerPO ${customerPO.id.slice(0,8)}`, weight: 60 });
      customerPOId = customerPO.id;
      ticketFromPo = customerPO.ticketId;
    }
    if (procurementOrder) {
      signals.push({ kind: "procurement_po", detail: `PO ${procurementOrder.poNo} → ProcurementOrder ${procurementOrder.id.slice(0,8)}`, weight: 50 });
      procurementOrderId = procurementOrder.id;
      ticketFromPo ??= procurementOrder.ticketId;
    }
  }

  // Supplier name signal — signals that the document is a bill, not a customer thread
  const supplierHit = await scanSupplierNames(poText);
  if (supplierHit) {
    signals.push({ kind: "supplier_name", detail: `supplier name "${supplierHit.hit}" → ${supplierHit.name}`, weight: 20 });
  }

  // Upgrade decision
  let confidence = base.confidence;
  let ticketId = base.ticketId;

  // PO-matched ticket is a very strong signal: overrides base LOW/MEDIUM
  if (ticketFromPo) {
    confidence = "HIGH";
    ticketId = ticketFromPo;
  }

  return {
    confidence,
    ticketId,
    reasons: signals.map((s) => s.detail),
    candidateCount: base.candidateCount,
    signals,
    matchedCustomerPOId: customerPOId,
    matchedProcurementOrderId: procurementOrderId,
    matchedSupplierId: supplierHit?.supplierId,
    textLength: combined.length,
  };
}

/**
 * Async hook called after a PDF / OCR worker finishes parsing an attachment.
 * Finds the owning thread, re-runs scoring with the new attachment text, and
 * upgrades the thread's linkConfidence if the new signals beat what's there.
 *
 * NEVER downgrades. NEVER overwrites linkSource=MANUAL. Writes an audit log.
 */
const CONF_RANK: Record<"LOW" | "MEDIUM" | "HIGH", number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export async function reconsiderThreadMatchForEvent(ingestionEventId: string): Promise<{
  upgraded: boolean;
  newConfidence: "LOW" | "MEDIUM" | "HIGH" | null;
  newTicketId: string | null;
  reason?: string;
}> {
  const msg = await prisma.inboxThreadMessage.findUnique({
    where: { ingestionEventId },
    select: { threadId: true },
  });
  if (!msg) return { upgraded: false, newConfidence: null, newTicketId: null };

  const thread = await prisma.inboxThread.findUnique({
    where: { id: msg.threadId },
    include: {
      messages: { select: { ingestionEventId: true } },
      linkedTicket: { select: { payingCustomerId: true } },
    },
  });
  if (!thread) return { upgraded: false, newConfidence: null, newTicketId: null };

  // NEVER override a manual link
  if (thread.linkSource === "MANUAL") {
    return { upgraded: false, newConfidence: thread.linkConfidence as "LOW"|"MEDIUM"|"HIGH" | null, newTicketId: thread.linkedTicketId, reason: "MANUAL link — not touched" };
  }

  // Combine subject + lastSnippet (stand-in for body) + attachment text
  const attachmentText = await loadAttachmentText(thread.messages.map((m) => m.ingestionEventId));
  if (!attachmentText) {
    return { upgraded: false, newConfidence: thread.linkConfidence as "LOW"|"MEDIUM"|"HIGH" | null, newTicketId: thread.linkedTicketId, reason: "no parsed attachment text yet" };
  }

  const scored = await resolveContentLinkWithAttachments({
    subject: thread.subject,
    body: thread.lastSnippet,
    attachmentText,
    customerId: thread.linkedTicket?.payingCustomerId,
  });

  const currentRank = CONF_RANK[(thread.linkConfidence as "LOW"|"MEDIUM"|"HIGH") ?? "LOW"];
  const newRank = CONF_RANK[scored.confidence];

  // Only upgrade if the new rank strictly beats OR we found a concrete ticketId
  // when the thread previously had none.
  const shouldUpgrade =
    (newRank > currentRank) ||
    (!thread.linkedTicketId && !!scored.ticketId && scored.confidence !== "LOW");

  if (!shouldUpgrade) {
    return {
      upgraded: false,
      newConfidence: thread.linkConfidence as "LOW"|"MEDIUM"|"HIGH" | null,
      newTicketId: thread.linkedTicketId,
      reason: `no upgrade (current ${thread.linkConfidence ?? "null"}, new ${scored.confidence})`,
    };
  }

  // Dominant signal explanation for the audit log
  const triggers = scored.signals.filter((s) => s.weight > 0);
  const reason = triggers.length
    ? triggers.map((t) => `${t.kind}: ${t.detail}`).join(" · ")
    : scored.reasons.join(" · ");

  await prisma.$transaction([
    prisma.inboxThread.update({
      where: { id: thread.id },
      data: {
        linkConfidence: scored.confidence,
        linkSource: "AUTO",
        linkedTicketId: scored.ticketId ?? thread.linkedTicketId,
        status: scored.confidence === "HIGH" && scored.ticketId ? "LINKED" : thread.status,
      },
    }),
    prisma.ingestionAuditLog.create({
      data: {
        objectType: "InboxThread",
        objectId: thread.id,
        actionType: "LINK_UPGRADED_BY_ATTACHMENT",
        actor: "SYSTEM:content-matcher",
        previousValueJson: {
          linkConfidence: thread.linkConfidence,
          linkedTicketId: thread.linkedTicketId,
          status: thread.status,
        },
        newValueJson: {
          linkConfidence: scored.confidence,
          linkedTicketId: scored.ticketId ?? thread.linkedTicketId,
          status: scored.confidence === "HIGH" && scored.ticketId ? "LINKED" : thread.status,
          matchedCustomerPOId: scored.matchedCustomerPOId,
          matchedProcurementOrderId: scored.matchedProcurementOrderId,
          matchedSupplierId: scored.matchedSupplierId,
          textLength: scored.textLength,
          signals: scored.signals,
        },
        reason,
      },
    }),
  ]);

  return { upgraded: true, newConfidence: scored.confidence, newTicketId: scored.ticketId ?? thread.linkedTicketId, reason };
}

