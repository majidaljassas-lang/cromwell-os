/**
 * Phase 7 — Legacy enquiry pipeline migration (one-off).
 *
 * Run:
 *   npx tsx src/scripts/phase-7-migrate-enquiries.ts --dry-run   # preview
 *   npx tsx src/scripts/phase-7-migrate-enquiries.ts             # apply
 *
 * Safety:
 *   • Idempotent — re-running after a successful pass is a no-op.
 *   • Per-record try/catch — one failure does NOT abort the others.
 *   • Each record is one transaction.
 *   • No fabrication — any enquiry that needs a customer but doesn't
 *     have `suggestedCustomerId` is marked LEGACY_ORPHAN and listed in
 *     the "manual follow-up needed" banner, never given a fake customer.
 *
 * Decision tree per enquiry (all non-CLOSED, non-LEGACY_ORPHAN):
 *
 *   enquiryType is ticket-shaped
 *       (DIRECT_ORDER | QUOTE_REQUEST | PRICING_FIRST | SPEC_REQUEST
 *        | COMPETITIVE_BID | APPROVAL)
 *     AND suggestedCustomerId IS NOT NULL
 *     → MIGRATE_TO_TICKET
 *
 *   enquiryType is ticket-shaped AND suggestedCustomerId IS NULL
 *     → ORPHAN_MANUAL_FOLLOWUP   (flagged in the summary banner)
 *
 *   enquiryType is non-ticket
 *       (OTHER | FOLLOW_UP | DELIVERY_UPDATE | DISPUTE)
 *     → ORPHAN_CLEAN
 */

import "dotenv/config";
import { PrismaClient } from "../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// ─── Setup ───────────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DRY_RUN = process.argv.includes("--dry-run");
const ORPHAN_STATUS = "LEGACY_ORPHAN";

const TICKETABLE_ENQUIRY_TYPES = new Set([
  "DIRECT_ORDER",
  "QUOTE_REQUEST",
  "PRICING_FIRST",
  "SPEC_REQUEST",
  "COMPETITIVE_BID",
  "APPROVAL",
]);

function mapEnquiryTypeToTicketMode(t: string): string {
  switch (t) {
    case "DIRECT_ORDER":    return "DIRECT_ORDER";
    case "QUOTE_REQUEST":   return "PRICING_FIRST";
    case "PRICING_FIRST":   return "PRICING_FIRST";
    case "SPEC_REQUEST":    return "SPEC_DRIVEN";
    case "COMPETITIVE_BID": return "COMPETITIVE_BID";
    case "APPROVAL":        return "PRICING_FIRST";
    default:                return "PRICING_FIRST";
  }
}

// ─── Decision model ──────────────────────────────────────────────────────────

type Action =
  | "ALREADY_DONE"
  | "MIGRATE_TO_TICKET"
  | "ORPHAN_MANUAL_FOLLOWUP"
  | "ORPHAN_CLEAN";

interface Decision {
  enquiryId: string;
  subject: string;
  enquiryType: string;
  currentStatus: string;
  suggestedCustomerId: string | null;
  workItemIds: string[];
  action: Action;
  reason: string;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const banner = DRY_RUN
    ? "=== Phase 7 migration — DRY RUN (no writes) ==="
    : "=== Phase 7 migration — APPLYING CHANGES ===";
  console.log(banner);
  console.log(`Started at ${new Date().toISOString()}\n`);

  const enquiries = await prisma.enquiry.findMany({
    where: {
      status: { notIn: ["CLOSED", ORPHAN_STATUS] },
    },
    include: {
      workItems: { select: { id: true, ticketId: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (enquiries.length === 0) {
    console.log("No enquiries left to migrate. Already idempotent.");
    await teardown();
    return;
  }

  console.log(`Found ${enquiries.length} enquiry row(s) to evaluate.\n`);

  const decisions: Decision[] = [];
  const ticketsCreated: Array<{ enquiryId: string; ticketId: string; title: string }> = [];
  const errors: Array<{ enquiryId: string; error: string }> = [];

  for (const enq of enquiries) {
    const workItemIds = enq.workItems.map((w) => w.id);
    const decision: Decision = {
      enquiryId: enq.id,
      subject: enq.subjectOrLabel ?? "(no subject)",
      enquiryType: enq.enquiryType,
      currentStatus: enq.status,
      suggestedCustomerId: enq.suggestedCustomerId,
      workItemIds,
      action: "ORPHAN_CLEAN",
      reason: "",
    };

    const ticketShaped = TICKETABLE_ENQUIRY_TYPES.has(enq.enquiryType);
    if (ticketShaped && enq.suggestedCustomerId) {
      decision.action = "MIGRATE_TO_TICKET";
      decision.reason = `Ticket-shaped (${enq.enquiryType}) with resolved customer — migrating.`;
    } else if (ticketShaped && !enq.suggestedCustomerId) {
      decision.action = "ORPHAN_MANUAL_FOLLOWUP";
      decision.reason = `Ticket-shaped (${enq.enquiryType}) but suggestedCustomerId is NULL — orphaning, manual follow-up needed.`;
    } else {
      decision.action = "ORPHAN_CLEAN";
      decision.reason = `Non-ticket enquiryType (${enq.enquiryType}) — orphaning as legacy noise.`;
    }

    decisions.push(decision);

    if (DRY_RUN) continue;

    try {
      if (decision.action === "MIGRATE_TO_TICKET") {
        const title = enq.subjectOrLabel || enq.rawText.slice(0, 80);
        const ticketMode = mapEnquiryTypeToTicketMode(enq.enquiryType);

        const { ticket } = await prisma.$transaction(async (tx) => {
          const t = await tx.ticket.create({
            data: {
              parentJobId: enq.parentJobId,
              siteId: enq.suggestedSiteId,
              siteCommercialLinkId: enq.suggestedSiteCommercialLinkId,
              payingCustomerId: enq.suggestedCustomerId!,
              requestedByContactId: enq.sourceContactId,
              title,
              description: enq.rawText,
              ticketMode: ticketMode as
                | "DIRECT_ORDER" | "PRICING_FIRST" | "SPEC_DRIVEN"
                | "COMPETITIVE_BID" | "RECOVERY" | "CASH_SALE"
                | "LABOUR_ONLY" | "PROJECT_WORK" | "NON_SITE",
              status: "CAPTURED",
              revenueState: "OPERATIONAL",
            },
            select: { id: true, ticketNo: true, title: true },
          });

          if (workItemIds.length > 0) {
            await tx.inquiryWorkItem.updateMany({
              where: { id: { in: workItemIds } },
              data: { ticketId: t.id, status: "CONVERTED" },
            });
          }

          await tx.enquiry.update({
            where: { id: enq.id },
            data: { status: "CONVERTED" },
          });

          await tx.event.create({
            data: {
              ticketId: t.id,
              eventType: "ENQUIRY_LOGGED",
              timestamp: new Date(),
              notes: `MIGRATED_FROM_ENQUIRY Phase 7 2026-04-15 legacy_enquiry_id=${enq.id}`,
            },
          });

          return { ticket: t };
        });

        ticketsCreated.push({ enquiryId: enq.id, ticketId: ticket.id, title: ticket.title });
      } else {
        // ORPHAN path (both manual-followup and clean)
        await prisma.$transaction(async (tx) => {
          await tx.enquiry.update({
            where: { id: enq.id },
            data: { status: ORPHAN_STATUS },
          });
          if (workItemIds.length > 0) {
            await tx.inquiryWorkItem.updateMany({
              where: { id: { in: workItemIds } },
              data: { status: "LEGACY_ORPHAN" },
            });
          }
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ enquiryId: enq.id, error: msg });
      console.error(`  ✗ ${enq.id} failed: ${msg}`);
    }
  }

  printSummary(decisions, ticketsCreated, errors);

  await teardown();
}

// ─── Presentation ────────────────────────────────────────────────────────────

function printSummary(
  decisions: Decision[],
  ticketsCreated: Array<{ enquiryId: string; ticketId: string; title: string }>,
  errors: Array<{ enquiryId: string; error: string }>
) {
  const byAction: Record<Action, Decision[]> = {
    ALREADY_DONE: [],
    MIGRATE_TO_TICKET: [],
    ORPHAN_MANUAL_FOLLOWUP: [],
    ORPHAN_CLEAN: [],
  };
  for (const d of decisions) byAction[d.action].push(d);

  console.log("\n─── Decision table ─────────────────────────────────────────────");
  for (const d of decisions) {
    const subj = d.subject.length > 50 ? d.subject.slice(0, 50) + "…" : d.subject;
    const wi = d.workItemIds.length > 0 ? ` wi=${d.workItemIds.length}` : "";
    console.log(
      `  ${d.action.padEnd(24)} ${d.enquiryType.padEnd(16)} ${d.enquiryId.slice(0, 8)}${wi}  "${subj}"`
    );
  }

  console.log("\n─── Counts ─────────────────────────────────────────────────────");
  console.log(`  MIGRATE_TO_TICKET       : ${byAction.MIGRATE_TO_TICKET.length}`);
  console.log(`  ORPHAN_MANUAL_FOLLOWUP  : ${byAction.ORPHAN_MANUAL_FOLLOWUP.length}`);
  console.log(`  ORPHAN_CLEAN            : ${byAction.ORPHAN_CLEAN.length}`);
  console.log(`  (errors)                : ${errors.length}`);

  if (byAction.ORPHAN_MANUAL_FOLLOWUP.length > 0) {
    console.log("\n⚠  MANUAL FOLLOW-UP NEEDED");
    console.log("   The following enquiries are ticket-shaped but have no");
    console.log("   resolved customer. They have been orphaned (LEGACY_ORPHAN).");
    console.log("   If you want to act on them, re-triage via the modern inbox");
    console.log("   flow where customer resolution happens explicitly.\n");
    for (const d of byAction.ORPHAN_MANUAL_FOLLOWUP) {
      console.log(`   • [${d.enquiryType}] ${d.enquiryId}  "${d.subject}"`);
    }
  }

  if (ticketsCreated.length > 0) {
    console.log("\n─── Tickets created ────────────────────────────────────────────");
    for (const t of ticketsCreated) {
      console.log(`   ${t.ticketId}  ←  enquiry ${t.enquiryId.slice(0, 8)}  "${t.title.slice(0, 60)}"`);
    }
  }

  if (errors.length > 0) {
    console.log("\n─── Errors ─────────────────────────────────────────────────────");
    for (const e of errors) {
      console.log(`   ${e.enquiryId}  ${e.error}`);
    }
  }

  console.log("\n" + (DRY_RUN ? "DRY RUN — no database changes were applied." : "All changes applied."));
  console.log(`Finished at ${new Date().toISOString()}\n`);
}

// ─── Teardown ────────────────────────────────────────────────────────────────

async function teardown() {
  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await teardown();
  process.exit(1);
});
