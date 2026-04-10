/**
 * Supplier Ack Matcher (deterministic, no LLM).
 *
 * Scans unactioned IngestionEvents, classifies each one, parses the
 * supplier doc into structured lines, anchors it to an active ticket
 * and — if confidence is HIGH — applies the mutation:
 *   - finds/creates Supplier
 *   - creates ProcurementOrder + lines
 *   - writes expectedCostUnit / supplierName back to matched TicketLines
 *   - marks the IngestionEvent ACTIONED
 *   - logs an [ACK-MATCH:xxxxxxxx] Event for audit + idempotency
 *
 * Anything with MEDIUM / LOW confidence, <2 line matches or no anchor
 * is logged only (never mutated).
 *
 * Every previously-processed event is skipped by looking for an
 * Event.notes starting with `[ACK-MATCH:<first 8 of eventId>]`.
 */

import { prisma } from "@/lib/prisma";
import { parseAcknowledgementText } from "@/lib/procurement/parse-acknowledgement";
import { anchorToTicket, type AnchorMatch } from "@/lib/procurement/site-alias";
import {
  matchAckLines,
  type DemandLine,
  type MatchResult,
} from "@/lib/procurement/match-ack-lines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ─── Config ──────────────────────────────────────────────────────────────────
const MAX_EVENTS_PER_RUN = 100;
const MAX_LOOKBACK_DAYS = 14;
const MIN_TEXT_LEN = 80;
const MIN_LINE_MATCHES_TO_APPLY = 2;

// ─── Document classification ─────────────────────────────────────────────────

type DocType =
  | "SUPPLIER_ACK"
  | "SUPPLIER_INVOICE"
  | "DELIVERY_NOTE"
  | "QUOTE"
  | "STATEMENT"
  | "REMITTANCE"
  | "NOISE";

interface ClassifyResult {
  type: DocType;
  reason: string;
}

function classifyDoc(subject: string, body: string): ClassifyResult {
  const s = (subject || "").toLowerCase();
  const b = (body || "").toLowerCase().slice(0, 4000);
  const text = `${s}\n${b}`;

  // Noise first — cheap rejects
  if (/(^|\s)(remittance|remit\s+advice)/i.test(text))
    return { type: "REMITTANCE", reason: "remittance keyword" };
  if (/(statement\s+of\s+account|account\s+statement|^statement$|monthly statement)/i.test(s))
    return { type: "STATEMENT", reason: "statement keyword" };
  if (/\bquotation\b|\bquote\s+(?:request|ref)\b|rfq\b/i.test(s))
    return { type: "QUOTE", reason: "quote keyword" };

  // Positive classes
  if (
    /(acknowledg(e?ment|ing)|order\s+confirm|order\s+ack|confirmation\s+of\s+order)/i.test(
      text
    )
  ) {
    return { type: "SUPPLIER_ACK", reason: "ack keyword" };
  }
  if (/\bproof\s+of\s+delivery|\bpod\b|\bdelivery\s+note\b|\bdespatch(?:ed)?\s+note/i.test(text)) {
    return { type: "DELIVERY_NOTE", reason: "delivery note keyword" };
  }
  if (
    /\binvoice\b/i.test(s) ||
    /\binvoice\s+(?:no|number|ref)/i.test(b) ||
    /\btax\s+invoice\b/i.test(text)
  ) {
    return { type: "SUPPLIER_INVOICE", reason: "invoice keyword" };
  }

  // Weak fallback: has "order" + structured qty/price text
  if (/\border\b/i.test(text) && /\b(qty|quantity|unit\s+price|net|vat)\b/i.test(b)) {
    return { type: "SUPPLIER_ACK", reason: "order + qty/price fallback" };
  }

  return { type: "NOISE", reason: "no supplier-doc signal" };
}

// ─── Payload helpers ─────────────────────────────────────────────────────────

function extractSubject(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;
  if (typeof r.subject === "string") return r.subject;
  return "";
}

function extractBodyText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;
  const body = r.body;
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.content === "string") return b.content;
    if (typeof b.text === "string") return b.text;
  }
  const preview = r.bodyPreview;
  if (typeof preview === "string") return preview;
  return "";
}

function extractSenderDomain(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const from = r.from;
  if (from && typeof from === "object") {
    const f = from as Record<string, unknown>;
    const ea = f.emailAddress as Record<string, unknown> | undefined;
    if (ea && typeof ea.address === "string") {
      const at = ea.address.indexOf("@");
      if (at !== -1) return ea.address.slice(at + 1).toLowerCase();
    }
  }
  return null;
}

/**
 * Look for "your order / your ref / cust po / customer order" style fields
 * in the parsed text. Returns the string that follows the label, trimmed
 * to the first line/colon.
 */
function extractCustomerRefFromText(text: string): string | null {
  if (!text) return null;
  const patterns = [
    /your\s*(?:order|reference|ref)\s*(?:no\.?|number)?\s*[:#]?\s*([^\n]{1,80})/i,
    /customer\s*(?:po|order|reference|ref)\s*(?:no\.?|number)?\s*[:#]?\s*([^\n]{1,80})/i,
    /cust(?:omer)?\s*ref\s*[:#]?\s*([^\n]{1,80})/i,
    /cust\s*po\s*[:#]?\s*([^\n]{1,80})/i,
    /site\s*(?:ref|reference|name)\s*[:#]?\s*([^\n]{1,80})/i,
    /job\s*(?:ref|reference|name)\s*[:#]?\s*([^\n]{1,80})/i,
    /deliver(?:y)?\s*to\s*[:#]?\s*([^\n]{1,80})/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && m[1]) {
      return m[1].trim().replace(/\s{2,}/g, " ").slice(0, 120);
    }
  }
  return null;
}

// ─── Types for the run summary ───────────────────────────────────────────────

interface RunDetail {
  eventId: string;
  subject: string;
  classification: DocType;
  anchor: AnchorMatch | null;
  linesParsed: number;
  stats?: MatchResult["stats"];
  applied: boolean;
  ticketNo?: number;
  poCreated?: string;
  note: string;
}

// ─── Main POST handler ───────────────────────────────────────────────────────

export async function POST(request: Request) {
  const started = Date.now();
  const url = new URL(request.url);
  const debugMode = url.searchParams.get("debug") === "1";

  const classified = { ack: 0, invoice: 0, delivery: 0, skipped: 0 };
  const anchored = { high: 0, medium: 0, low: 0, none: 0 };
  const applied = { ordersCreated: 0, linesUpdated: 0, linesAdded: 0 };
  const errors: string[] = [];
  const details: RunDetail[] = [];

  try {
    // ────────────────────────────────────────────────────────────────────────
    // 1. Candidate events.
    // ────────────────────────────────────────────────────────────────────────
    const cutoff = new Date(
      Date.now() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    );

    // Cast a wide net on source type — emails have landed under several
    // different `sourceRecordType` values depending on which ingestion
    // route recorded them. We filter out WhatsApp / voice notes etc by
    // name and also via the ingestion-source type (OUTLOOK).
    const targetIds = (url.searchParams.get("targetIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const baseWhere = targetIds.length > 0
      ? { id: { in: targetIds } }
      : {
          OR: [
            {
              sourceRecordType: {
                in: ["EMAIL", "INBOUND_EMAIL", "SENT_EMAIL"],
              },
            },
            { source: { sourceType: { in: ["OUTLOOK", "EMAIL"] as any } } },
          ],
          status: {
            in: ["PARSED", "CLASSIFIED", "NEEDS_TRIAGE", "NEEDS_ACTION"],
          },
          receivedAt: { gte: cutoff },
        };

    const rawCandidates = await prisma.ingestionEvent.findMany({
      where: baseWhere,
      select: {
        id: true,
        status: true,
        rawPayload: true,
        receivedAt: true,
        errorMessage: true,
        parsedMessages: {
          select: { id: true, extractedText: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { receivedAt: "desc" },
      take: MAX_EVENTS_PER_RUN * 3,
    });

    // Filter out ones already processed (Event.notes startsWith [ACK-MATCH:xxxxxxxx])
    const allPrefixes = rawCandidates.map((c) => `[ACK-MATCH:${c.id.slice(0, 8)}]`);
    const alreadyLogged =
      allPrefixes.length > 0
        ? await prisma.event.findMany({
            where: {
              OR: allPrefixes.map((p) => ({ notes: { startsWith: p } })),
            },
            select: { notes: true },
          })
        : [];
    const loggedSet = new Set(
      alreadyLogged
        .map((e) => {
          const m = /^\[ACK-MATCH:([a-f0-9]{8})\]/i.exec(e.notes || "");
          return m ? m[1] : null;
        })
        .filter((x): x is string => !!x)
    );

    const candidates = rawCandidates
      .filter((c) => targetIds.length > 0 || !loggedSet.has(c.id.slice(0, 8)))
      // Skip events we've already tombstoned as noise in a previous run.
      .filter((c) => targetIds.length > 0 || !(c as { errorMessage?: string | null }).errorMessage?.startsWith("[ack-matcher]"))
      .filter((c) => {
        // Accept the event if we have *any* meaningful text, whether from
        // the parsed-message extractedText OR from the rawPayload body.
        const parsedText = c.parsedMessages[0]?.extractedText || "";
        if (parsedText.length >= MIN_TEXT_LEN) return true;
        const rawBody = extractBodyText(c.rawPayload);
        const subj = extractSubject(c.rawPayload);
        return (rawBody.length + subj.length) >= MIN_TEXT_LEN;
      })
      .slice(0, MAX_EVENTS_PER_RUN);

    if (debugMode) {
      const searchTerm = url.searchParams.get("search");
      if (searchTerm) {
        const found = await prisma.ingestionEvent.findMany({
          where: {
            parsedMessages: {
              some: { extractedText: { contains: searchTerm, mode: "insensitive" } },
            },
          },
          select: {
            id: true,
            status: true,
            sourceRecordType: true,
            receivedAt: true,
            parsedMessages: {
              select: { extractedText: true },
              take: 1,
            },
          },
          take: 20,
        });
        return Response.json({
          debug: true,
          searchTerm,
          found: found.map((f) => ({
            id: f.id,
            status: f.status,
            sourceRecordType: f.sourceRecordType,
            receivedAt: f.receivedAt,
            snippet: (f.parsedMessages[0]?.extractedText || "").slice(0, 300),
            totalLen: (f.parsedMessages[0]?.extractedText || "").length,
          })),
        });
      }
      // Count of all [ACK-MATCH:] audit events
      const ackEvents = await prisma.event.count({
        where: { notes: { startsWith: "[ACK-MATCH:" } },
      });
      const autoPos = await prisma.procurementOrder.findMany({
        where: {
          OR: [
            { poNo: { startsWith: "AUTO-" } },
            { poNo: { startsWith: "0001/" } },
          ],
          issuedAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
        },
        select: { id: true, poNo: true, ticket: { select: { ticketNo: true } }, totalCostExpected: true, lines: { select: { id: true } } },
      });
      const totalCount = await prisma.ingestionEvent.count({});
      const outlookCount = await prisma.ingestionEvent.count({
        where: { source: { sourceType: { in: ["OUTLOOK", "EMAIL"] as any } } },
      });
      const outlookInWindow = await prisma.ingestionEvent.count({
        where: {
          source: { sourceType: { in: ["OUTLOOK", "EMAIL"] as any } },
          receivedAt: { gte: cutoff },
        },
      });
      const outlookByStatus = await prisma.ingestionEvent.groupBy({
        by: ["status"],
        where: {
          source: { sourceType: { in: ["OUTLOOK", "EMAIL"] as any } },
          receivedAt: { gte: cutoff },
        },
        _count: { _all: true },
      });
      const byRecordType = await prisma.ingestionEvent.groupBy({
        by: ["sourceRecordType"],
        where: {
          source: { sourceType: { in: ["OUTLOOK", "EMAIL"] as any } },
          receivedAt: { gte: cutoff },
        },
        _count: { _all: true },
      });
      return Response.json({
        debug: true,
        totalCount,
        outlookCount,
        outlookInWindow,
        outlookByStatus,
        byRecordType,
        ackAuditEvents: ackEvents,
        recentPOs: autoPos.map((p) => ({
          poNo: p.poNo,
          ticketNo: p.ticket.ticketNo,
          totalCost: Number(p.totalCostExpected),
          lineCount: p.lines.length,
        })),
        rawCandidatesCount: rawCandidates.length,
        afterIdempotency: rawCandidates.filter(
          (c) => !loggedSet.has(c.id.slice(0, 8))
        ).length,
        afterTextLen: candidates.length,
      });
    }

    // ────────────────────────────────────────────────────────────────────────
    // 2. Per-event processing.
    // ────────────────────────────────────────────────────────────────────────
    for (const ev of candidates) {
      try {
        const subject = extractSubject(ev.rawPayload);
        const bodyText = extractBodyText(ev.rawPayload);
        const parsedExtract = ev.parsedMessages[0]?.extractedText || "";
        // Prefer the parsed-message text (includes attachment PDFs), but
        // fall back to the raw email body when parsing didn't yield much.
        const parsedText =
          parsedExtract.length >= MIN_TEXT_LEN
            ? parsedExtract
            : `${subject}\n${bodyText}\n${parsedExtract}`;
        const senderDomain = extractSenderDomain(ev.rawPayload);
        const combinedText = `${subject}\n${bodyText}\n${parsedExtract}`;

        // Classify
        const cls = classifyDoc(subject, `${bodyText}\n${parsedText}`);
        if (
          cls.type !== "SUPPLIER_ACK" &&
          cls.type !== "SUPPLIER_INVOICE" &&
          cls.type !== "DELIVERY_NOTE"
        ) {
          classified.skipped++;
          // Tombstone the event so we don't reclassify it every run.
          try {
            await prisma.ingestionEvent.update({
              where: { id: ev.id },
              data: {
                errorMessage: `[ack-matcher] skipped ${cls.type}: ${cls.reason}`.slice(0, 500),
              },
            });
          } catch {
            // best-effort — don't fail the run
          }
          details.push({
            eventId: ev.id,
            subject,
            classification: cls.type,
            anchor: null,
            linesParsed: 0,
            applied: false,
            note: `Skipped: ${cls.reason}`,
          });
          continue;
        }

        if (cls.type === "SUPPLIER_ACK") classified.ack++;
        else if (cls.type === "SUPPLIER_INVOICE") classified.invoice++;
        else classified.delivery++;

        // Parse lines
        const parsed = parseAcknowledgementText(parsedText);

        // Anchor
        const customerRef = extractCustomerRefFromText(parsedText);
        const anchor = await anchorToTicket(prisma, {
          customerRef,
          poRef: parsed.orderRef,
          subject,
          bodySnippet: combinedText.slice(0, 4000),
          senderDomain,
        });

        if (!anchor) {
          anchored.none++;
          errors.push(
            `event ${ev.id.slice(0, 8)}: no anchor (${cls.type}, ${parsed.lines.length} lines) subject="${subject.slice(0, 80)}"`
          );
          details.push({
            eventId: ev.id,
            subject,
            classification: cls.type,
            anchor: null,
            linesParsed: parsed.lines.length,
            applied: false,
            note: "No anchor — cannot log Event (ticketId required)",
          });
          continue;
        }

        if (anchor.confidence === "high") anchored.high++;
        else if (anchor.confidence === "medium") anchored.medium++;
        else anchored.low++;

        // Load open demand lines for the anchored ticket
        const openLines = await prisma.ticketLine.findMany({
          where: {
            ticketId: anchor.ticketId,
            status: {
              notIn: ["CLOSED", "INVOICED", "RETURNED"] as any,
            },
          },
          select: {
            id: true,
            description: true,
            normalizedItemName: true,
            qty: true,
            unit: true,
          },
        });
        const demand: DemandLine[] = openLines.map((l) => ({
          id: l.id,
          description: l.description,
          normalizedItemName: l.normalizedItemName,
          qty: Number(l.qty),
          unit: String(l.unit),
        }));

        const result = matchAckLines(parsed.lines, demand);

        // Decide: apply or log
        const shouldApply =
          anchor.confidence === "high" &&
          result.stats.exact + result.stats.substitution >=
            MIN_LINE_MATCHES_TO_APPLY;

        if (!shouldApply) {
          // Log only
          const summary = `[ACK-MATCH:${ev.id.slice(0, 8)}] ${cls.type} ${parsed.supplierName ?? ""} ${parsed.orderRef ?? ""} — anchor=${anchor.confidence} T#${anchor.ticketNo} (${anchor.matchedOn}); parsed=${parsed.lines.length} lines; matched e${result.stats.exact}/s${result.stats.substitution}/x${result.stats.extra}/m${result.stats.missing} — LOG ONLY`;
          await prisma.event.create({
            data: {
              ticketId: anchor.ticketId,
              eventType: "AUTO_STATUS_PROGRESSED",
              timestamp: new Date(),
              sourceRef: `ack-matcher:${ev.id}`,
              notes: summary.slice(0, 4000),
            },
          });
          details.push({
            eventId: ev.id,
            subject,
            classification: cls.type,
            anchor,
            linesParsed: parsed.lines.length,
            stats: result.stats,
            applied: false,
            ticketNo: anchor.ticketNo,
            note: `Log only: ${
              anchor.confidence !== "high"
                ? "confidence below high"
                : "fewer than 2 line matches"
            }`,
          });
          continue;
        }

        // ────────────────────────────────────────────────────────────────────
        // APPLY — high confidence + enough matches
        // ────────────────────────────────────────────────────────────────────
        const poResult = await applyAck({
          prisma,
          eventId: ev.id,
          anchor,
          parsed,
          result,
          classification: cls.type,
        });

        applied.ordersCreated += poResult.orderCreated ? 1 : 0;
        applied.linesUpdated += poResult.linesUpdated;
        applied.linesAdded += poResult.linesAdded;

        details.push({
          eventId: ev.id,
          subject,
          classification: cls.type,
          anchor,
          linesParsed: parsed.lines.length,
          stats: result.stats,
          applied: true,
          ticketNo: anchor.ticketNo,
          poCreated: poResult.poNo,
          note: `Applied: ${poResult.linesAdded} PO lines, ${poResult.linesUpdated} TL cost writebacks`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`event ${ev.id.slice(0, 8)}: ${msg}`);
      }
    }

    return Response.json(
      {
        ok: true,
        scanned: candidates.length,
        classified,
        anchored,
        applied,
        errors,
        details,
        durationMs: Date.now() - started,
      },
      { status: 200 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ack-matcher] top-level failure:", msg);
    return Response.json(
      {
        ok: false,
        scanned: 0,
        classified,
        anchored,
        applied,
        errors: [...errors, msg],
        details,
        durationMs: Date.now() - started,
      },
      { status: 200 } // NEVER 500 — trickle-down must not break
    );
  }
}

// ─── APPLY helper ────────────────────────────────────────────────────────────

interface ApplyArgs {
  prisma: typeof prisma;
  eventId: string;
  anchor: AnchorMatch;
  parsed: ReturnType<typeof parseAcknowledgementText>;
  result: MatchResult;
  classification: DocType;
}

interface ApplyResult {
  poNo: string;
  orderCreated: boolean;
  linesAdded: number;
  linesUpdated: number;
}

async function applyAck(args: ApplyArgs): Promise<ApplyResult> {
  const { prisma, eventId, anchor, parsed, result, classification } = args;

  // 1. Resolve or create supplier
  const supplierName = (parsed.supplierName || "Unknown Supplier").trim();
  let supplier = await prisma.supplier.findFirst({
    where: { name: { equals: supplierName, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: { name: supplierName },
      select: { id: true, name: true },
    });
  }

  // 2. Compute PO number.
  //    Use parsed supplier ref if present, else synthesise from event id.
  const supplierRef = parsed.orderRef?.trim() || null;
  const poNo = supplierRef || `AUTO-${eventId.slice(0, 8).toUpperCase()}`;

  // Idempotency: if a PO already exists for this ticket + supplier + ref, reuse it.
  let existingPo = null as { id: string; poNo: string } | null;
  if (supplierRef) {
    existingPo = await prisma.procurementOrder.findFirst({
      where: {
        ticketId: anchor.ticketId,
        supplierId: supplier.id,
        OR: [{ poNo: supplierRef }, { supplierRef }],
      },
      select: { id: true, poNo: true },
    });
  }

  const totalCost = result.matches
    .filter((m) => m.matchType !== "extra")
    .reduce((s, m) => s + Number(m.supplyLine.lineTotal || 0), 0);

  let poId: string;
  let orderCreated = false;
  if (existingPo) {
    poId = existingPo.id;
  } else {
    const created = await prisma.procurementOrder.create({
      data: {
        ticketId: anchor.ticketId,
        supplierId: supplier.id,
        poNo,
        supplierRef,
        issuedAt: new Date(),
        status: classification === "SUPPLIER_INVOICE" ? "INVOICED" : "ACKNOWLEDGED",
        totalCostExpected: totalCost,
      },
      select: { id: true },
    });
    poId = created.id;
    orderCreated = true;
  }

  // 3. Create PO lines + update matched TicketLines
  let linesAdded = 0;
  let linesUpdated = 0;

  for (const m of result.matches) {
    const tlId = m.demandLineId;
    // Skip duplicate PO line: find one with same description on the PO
    const existingLine = await prisma.procurementOrderLine.findFirst({
      where: {
        procurementOrderId: poId,
        description: m.supplyLine.description,
        qty: m.supplyLine.qty,
      },
      select: { id: true },
    });
    if (!existingLine) {
      await prisma.procurementOrderLine.create({
        data: {
          procurementOrderId: poId,
          ticketLineId: tlId || null,
          description: m.supplyLine.description,
          qty: m.supplyLine.qty,
          unitCost: m.supplyLine.unitCost,
          lineTotal: m.supplyLine.lineTotal,
          matchStatus:
            m.matchType === "exact"
              ? "MATCHED"
              : m.matchType === "substitution"
                ? "SUBSTITUTION"
                : "UNMATCHED",
        },
      });
      linesAdded++;
    }

    // Writeback expectedCostUnit + supplierName for exact/substitution matches
    if (tlId && m.matchType !== "extra") {
      await prisma.ticketLine.update({
        where: { id: tlId },
        data: {
          expectedCostUnit: m.supplyLine.unitCost,
          expectedCostTotal: m.supplyLine.lineTotal,
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierReference: supplierRef,
        },
      });
      linesUpdated++;
    }
  }

  // 4. Mark the IngestionEvent ACTIONED + create an IngestionLink back to the ticket
  await prisma.ingestionEvent.update({
    where: { id: eventId },
    data: { status: "ACTIONED", processedAt: new Date() },
  });

  // Find the parsed message id to create a link
  const pm = await prisma.parsedMessage.findFirst({
    where: { ingestionEventId: eventId },
    select: { id: true },
  });
  if (pm) {
    // Idempotency: don't create a duplicate link
    const existingLink = await prisma.ingestionLink.findFirst({
      where: { parsedMessageId: pm.id, ticketId: anchor.ticketId },
      select: { id: true },
    });
    if (!existingLink) {
      await prisma.ingestionLink.create({
        data: {
          parsedMessageId: pm.id,
          ticketId: anchor.ticketId,
          linkStatus: "AUTO_LINKED",
          linkConfidence: 95,
        },
      });
    }
  }

  // 5. Audit Event row with [ACK-MATCH:xxxxxxxx] marker
  const summary = `[ACK-MATCH:${eventId.slice(0, 8)}] ${classification} ${supplier.name} ${poNo}: e${result.stats.exact}/s${result.stats.substitution}/x${result.stats.extra}/m${result.stats.missing} — PO £${totalCost.toFixed(2)} — anchor=high ${anchor.matchedOn}`;
  await prisma.event.create({
    data: {
      ticketId: anchor.ticketId,
      eventType: "AUTO_PO_CREATED",
      timestamp: new Date(),
      sourceRef: `ack-matcher:${eventId}`,
      notes: summary.slice(0, 4000),
    },
  });

  return { poNo, orderCreated, linesAdded, linesUpdated };
}
