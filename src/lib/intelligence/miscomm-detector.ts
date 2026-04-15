/**
 * Miscomm detector — scans recent InboxThreadMessages on tickets with
 * live POs / LogisticsEvents for conflicting instructions from different
 * contacts. Uses Claude (graceful fallback to rule-based) to extract
 * delivery-address, cancellation, urgency, and instruction-change signals.
 *
 * Public API:
 *   runMiscommDetection({ limit?, sinceHours? })
 *     Sweeps messages, creates MISCOMM_DETECTED URGENT tasks when two
 *     contacts on the same ticket give conflicting instructions within
 *     the window. Infers contact roles (CLIENT_CONTACT / OPERATIVE) on
 *     SiteContactLink.inferredRole.
 *
 * Idempotency: MISCOMM_DETECTED task dedup on (ticketId, taskType, status).
 * One open miscomm task per ticket at a time — additional conflicts on
 * the same ticket append to the existing task's body.
 */

import { prisma } from "@/lib/prisma";
import { callClaude, isAiEnabled } from "@/lib/ai/anthropic";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MiscommSignal {
  type: "ADDRESS" | "CANCELLATION" | "URGENCY" | "INSTRUCTION_CHANGE";
  content: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface MiscommConflict {
  ticketId: string;
  ticketNo: number;
  contactA: { sender: string; at: Date; signal: MiscommSignal };
  contactB: { sender: string; at: Date; signal: MiscommSignal };
  summary: string;
}

export interface MiscommDetectionResult {
  ok: boolean;
  ticketsScanned: number;
  messagesScanned: number;
  conflictsFound: number;
  tasksCreated: number;
  tasksAppended: number;
  rolesInferred: number;
  conflicts: MiscommConflict[];
  errors: Array<{ ticketId: string; error: string }>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function runMiscommDetection(
  opts: { limit?: number; sinceHours?: number } = {}
): Promise<MiscommDetectionResult> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const sinceHours = opts.sinceHours ?? 72;
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

  const result: MiscommDetectionResult = {
    ok: true,
    ticketsScanned: 0,
    messagesScanned: 0,
    conflictsFound: 0,
    tasksCreated: 0,
    tasksAppended: 0,
    rolesInferred: 0,
    conflicts: [],
    errors: [],
  };

  // Find tickets with open POs or scheduled/failed logistics events
  const candidateTickets = await prisma.ticket.findMany({
    where: {
      status: { notIn: ["CLOSED", "INVOICED", "LOCKED"] },
      OR: [
        { procurementOrders: { some: { status: { notIn: ["DELIVERED", "CANCELLED", "CLOSED"] } } } },
        { logisticsEvents: { some: {} } },
      ],
      inboxThreads: { some: { messages: { some: { occurredAt: { gte: since } } } } },
    },
    select: {
      id: true,
      ticketNo: true,
      siteId: true,
      site: { select: { postcode: true, addressLine1: true } },
      inboxThreads: {
        select: {
          id: true,
          messages: {
            where: { occurredAt: { gte: since } },
            orderBy: { occurredAt: "asc" },
            select: {
              id: true,
              sender: true,
              snippet: true,
              occurredAt: true,
              ingestionEventId: true,
            },
          },
        },
      },
    },
    take: limit,
  });

  for (const ticket of candidateTickets) {
    try {
      result.ticketsScanned += 1;

      const allMessages = ticket.inboxThreads.flatMap((t) => t.messages);
      result.messagesScanned += allMessages.length;
      if (allMessages.length < 2) continue;

      // Per-sender latest signal for conflict comparison
      const bySender = new Map<
        string,
        { sender: string; at: Date; signal: MiscommSignal }
      >();

      for (const msg of allMessages) {
        if (!msg.sender || !msg.snippet) continue;
        const signal = await extractSignal(msg.snippet);
        if (!signal) continue;
        const prev = bySender.get(msg.sender);
        if (!prev || prev.at < msg.occurredAt) {
          bySender.set(msg.sender, {
            sender: msg.sender,
            at: msg.occurredAt,
            signal,
          });
        }
      }

      // Compare pairs of sender signals
      const signals = Array.from(bySender.values());
      const conflicts: MiscommConflict[] = [];
      for (let i = 0; i < signals.length; i++) {
        for (let j = i + 1; j < signals.length; j++) {
          const c = compareSignals(signals[i], signals[j]);
          if (c) {
            conflicts.push({
              ticketId: ticket.id,
              ticketNo: ticket.ticketNo,
              contactA: signals[i],
              contactB: signals[j],
              summary: c,
            });
          }
        }
      }

      if (conflicts.length > 0) {
        result.conflictsFound += conflicts.length;
        result.conflicts.push(...conflicts);

        const taskOutcome = await upsertMiscommTask(ticket.id, conflicts);
        if (taskOutcome.created) result.tasksCreated += 1;
        else if (taskOutcome.appended) result.tasksAppended += 1;
      }

      // Infer contact roles on this ticket's site
      if (ticket.siteId) {
        const inferred = await inferContactRoles(
          ticket.siteId,
          ticket.inboxThreads.flatMap((t) => t.messages)
        );
        result.rolesInferred += inferred;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ ticketId: ticket.id, error: msg });
      result.ok = false;
      console.error(`[miscomm-detector] ticket ${ticket.id} failed:`, err);
    }
  }

  return result;
}

// ─── Signal extraction ───────────────────────────────────────────────────────

const UK_POSTCODE_RE = /\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s?([0-9][A-Z]{2})\b/i;
const CANCEL_RE = /\b(cancel|cancelled|stop|don'?t proceed|hold (off|on)|scrap)\b/i;
const URGENT_RE = /\b(urgent|asap|immediately|right now|emergency|critical)\b/i;
const INSTRUCTION_RE = /\b(instead of|change|amend|revise|update|new instruction|different)\b/i;

async function extractSignal(text: string): Promise<MiscommSignal | null> {
  // Rule-based first — cheap and deterministic
  const pc = text.match(UK_POSTCODE_RE);
  if (pc) {
    return {
      type: "ADDRESS",
      content: `${pc[1]} ${pc[2]}`.toUpperCase(),
      confidence: "HIGH",
    };
  }
  if (CANCEL_RE.test(text)) {
    return { type: "CANCELLATION", content: text.slice(0, 120), confidence: "HIGH" };
  }
  if (INSTRUCTION_RE.test(text)) {
    return { type: "INSTRUCTION_CHANGE", content: text.slice(0, 120), confidence: "MEDIUM" };
  }
  if (URGENT_RE.test(text)) {
    return { type: "URGENCY", content: text.slice(0, 120), confidence: "MEDIUM" };
  }

  // AI fallback for subtle signals, only when a key is configured
  if (!isAiEnabled() || text.length < 30) return null;
  try {
    const { text: out } = await callClaude(
      "You are extracting operational signals from construction-materials messages. " +
        "Return JSON only: {type: \"ADDRESS\"|\"CANCELLATION\"|\"URGENCY\"|\"INSTRUCTION_CHANGE\"|\"NONE\", content: short string, confidence: \"HIGH\"|\"MEDIUM\"|\"LOW\"}. " +
        "Return NONE if nothing notable.",
      text.slice(0, 1200),
      { maxTokens: 200, temperature: 0 }
    );
    const parsed = safeJson(out);
    if (!parsed || parsed.type === "NONE") return null;
    return {
      type: parsed.type,
      content: String(parsed.content ?? "").slice(0, 120),
      confidence: parsed.confidence ?? "LOW",
    };
  } catch {
    return null;
  }
}

function safeJson(s: string): any {
  try {
    const m = s.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

// ─── Conflict comparison ─────────────────────────────────────────────────────

function compareSignals(
  a: { sender: string; at: Date; signal: MiscommSignal },
  b: { sender: string; at: Date; signal: MiscommSignal }
): string | null {
  if (a.sender === b.sender) return null;

  // Address conflicts: two distinct postcodes from different contacts
  if (a.signal.type === "ADDRESS" && b.signal.type === "ADDRESS") {
    if (a.signal.content !== b.signal.content) {
      return `Address conflict: ${a.sender} said "${a.signal.content}", ${b.sender} said "${b.signal.content}".`;
    }
    return null;
  }

  // Cancellation vs urgency/instruction — opposite directions
  if (a.signal.type === "CANCELLATION" && b.signal.type !== "CANCELLATION") {
    return `Cancellation vs active instruction: ${a.sender} signalled cancellation; ${b.sender} issued a live ${b.signal.type.toLowerCase()}.`;
  }
  if (b.signal.type === "CANCELLATION" && a.signal.type !== "CANCELLATION") {
    return `Cancellation vs active instruction: ${b.sender} signalled cancellation; ${a.sender} issued a live ${a.signal.type.toLowerCase()}.`;
  }

  // Instruction-change pairs from different contacts within 24h
  if (
    a.signal.type === "INSTRUCTION_CHANGE" &&
    b.signal.type === "INSTRUCTION_CHANGE"
  ) {
    const hoursApart = Math.abs(a.at.getTime() - b.at.getTime()) / (60 * 60 * 1000);
    if (hoursApart <= 24) {
      return `Two contacts issued instruction changes within 24h: ${a.sender} @ ${a.at.toISOString()}, ${b.sender} @ ${b.at.toISOString()}.`;
    }
  }

  return null;
}

// ─── Task creation / append ──────────────────────────────────────────────────

async function upsertMiscommTask(
  ticketId: string,
  conflicts: MiscommConflict[]
): Promise<{ created: boolean; appended: boolean }> {
  const existing = await prisma.task.findFirst({
    where: {
      ticketId,
      taskType: "MISCOMM_DETECTED",
      status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
    },
    select: { id: true, draftBody: true, generatedReason: true },
  });

  const body = buildMiscommBody(conflicts);
  const reason = `${conflicts.length} conflict(s) detected across ${
    new Set(conflicts.flatMap((c) => [c.contactA.sender, c.contactB.sender])).size
  } contact(s).`;

  if (existing) {
    const merged =
      (existing.draftBody ?? "") +
      "\n\n--- additional sweep " +
      new Date().toISOString() +
      " ---\n" +
      body;
    await prisma.task.update({
      where: { id: existing.id },
      data: {
        draftBody: merged.slice(0, 16000),
        generatedReason:
          (existing.generatedReason ?? "") + ` | +${conflicts.length} conflict(s)`,
      },
    });
    return { created: false, appended: true };
  }

  await prisma.task.create({
    data: {
      ticketId,
      taskType: "MISCOMM_DETECTED",
      priority: "URGENT",
      status: "OPEN",
      dueAt: endOfToday(),
      generatedReason: reason,
      draftBody: body,
    },
  });
  return { created: true, appended: false };
}

function buildMiscommBody(conflicts: MiscommConflict[]): string {
  const lines = [
    `Miscommunication detected on ticket — hold all automated changes.`,
    ``,
  ];
  for (const c of conflicts) {
    lines.push(`• ${c.summary}`);
    lines.push(`    ${c.contactA.sender} @ ${c.contactA.at.toISOString()}: ${c.contactA.signal.type} "${c.contactA.signal.content}"`);
    lines.push(`    ${c.contactB.sender} @ ${c.contactB.at.toISOString()}: ${c.contactB.signal.type} "${c.contactB.signal.content}"`);
    lines.push(``);
  }
  lines.push(`Action: confirm which instruction is correct, then resolve this task.`);
  return lines.join("\n");
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(17, 0, 0, 0);
  return d;
}

// ─── Contact role inference ──────────────────────────────────────────────────

async function inferContactRoles(
  siteId: string,
  messages: Array<{ sender: string | null; occurredAt: Date }>
): Promise<number> {
  if (messages.length === 0) return 0;

  // Build sender → earliest timestamp map
  const firstSeen = new Map<string, Date>();
  for (const m of messages) {
    if (!m.sender) continue;
    const prev = firstSeen.get(m.sender);
    if (!prev || m.occurredAt < prev) firstSeen.set(m.sender, m.occurredAt);
  }
  if (firstSeen.size === 0) return 0;

  // The earliest sender = CLIENT_CONTACT, others = OPERATIVE
  const ordered = Array.from(firstSeen.entries()).sort(
    (a, b) => a[1].getTime() - b[1].getTime()
  );
  const clientSender = ordered[0][0];

  let updated = 0;
  for (const [sender] of ordered) {
    // Resolve sender → Contact by email (case-insensitive)
    const contact = await prisma.contact.findFirst({
      where: { email: { equals: sender, mode: "insensitive" } },
      select: { id: true },
    });
    if (!contact) continue;

    const link = await prisma.siteContactLink.findFirst({
      where: { siteId, contactId: contact.id, isActive: true },
      select: { id: true, inferredRole: true },
    });
    if (!link) continue;

    const targetRole = sender === clientSender ? "CLIENT_CONTACT" : "OPERATIVE";
    // Never demote — CLIENT_CONTACT stays CLIENT_CONTACT
    if (link.inferredRole === "CLIENT_CONTACT" && targetRole === "OPERATIVE") continue;
    if (link.inferredRole === targetRole) continue;

    await prisma.siteContactLink.update({
      where: { id: link.id },
      data: { inferredRole: targetRole },
    });
    updated += 1;
  }
  return updated;
}
