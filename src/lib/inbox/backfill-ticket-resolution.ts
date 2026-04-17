/**
 * Backfill customer + site on tickets created from inbox threads.
 *
 * Why: when Majid manually creates a ticket from an inbox thread (rather
 * than the auto-ticket-creator firing), the ticket may end up with a
 * placeholder customer or no site assigned, even though the InboxThread
 * already has aiEntities ({siteName, customerName, ...}) extracted.
 * This module re-runs the same resolveCustomer/resolveSite helpers used
 * by Phase 12 against those tickets and writes the missing values.
 *
 * Idempotent: only fills blanks. Never overwrites a value Majid set
 * manually. Skips tickets where manualMode=true.
 *
 * "Auto-intake" placeholder customers (created by auto-ticket-creator
 * fallback strategy 4) are also considered "missing" and get re-resolved
 * — those names contain "(auto-intake)" by convention.
 */

import { prisma } from "@/lib/prisma";
import { resolveCustomer, resolveSite } from "@/lib/inbox/auto-ticket-creator";

interface BackfillReport {
  ticketId: string;
  ticketNo: number;
  customerSet: boolean;
  customerName?: string;
  customerWasPlaceholder: boolean;
  siteSet: boolean;
  siteName?: string;
  siteCommercialLinkSet: boolean;
}

export interface BackfillResult {
  scanned: number;
  updated: BackfillReport[];
  skipped: number;
  errors: Array<{ ticketId: string; error: string }>;
}

const PLACEHOLDER_MARKERS = ["(auto-intake)", "(intake)"];

function isPlaceholderCustomer(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return PLACEHOLDER_MARKERS.some((m) => lower.includes(m));
}

export async function runBackfillTicketResolution(
  opts: { limit?: number } = {},
): Promise<BackfillResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  // Find candidates: tickets that
  //  - are linked to at least one InboxThread (so we have aiEntities to work with)
  //  - are not in manual mode
  //  - are not yet closed/locked
  //  - either have no site OR their customer is an auto-intake placeholder
  const candidates = await prisma.ticket.findMany({
    where: {
      manualMode: false,
      status: { notIn: ["CLOSED", "LOCKED"] },
      inboxThreads: { some: {} },
      OR: [
        { siteId: null },
        { payingCustomer: { name: { contains: "(auto-intake)", mode: "insensitive" } } },
        { payingCustomer: { name: { contains: "(intake)", mode: "insensitive" } } },
      ],
    },
    select: {
      id: true,
      ticketNo: true,
      siteId: true,
      siteCommercialLinkId: true,
      payingCustomerId: true,
      payingCustomer: { select: { id: true, name: true } },
      inboxThreads: {
        select: {
          id: true,
          channel: true,
          conversationKey: true,
          participants: true,
          aiEntities: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
    take: limit,
  });

  const result: BackfillResult = {
    scanned: candidates.length,
    updated: [],
    skipped: 0,
    errors: [],
  };

  for (const ticket of candidates) {
    const thread = ticket.inboxThreads[0];
    if (!thread) {
      result.skipped++;
      continue;
    }

    try {
      const update: Record<string, unknown> = {};
      const report: BackfillReport = {
        ticketId: ticket.id,
        ticketNo: ticket.ticketNo,
        customerSet: false,
        customerWasPlaceholder: isPlaceholderCustomer(ticket.payingCustomer?.name),
        siteSet: false,
        siteCommercialLinkSet: false,
      };

      // Customer: only re-resolve if current value is a placeholder.
      // We never overwrite a real customer — Majid may have picked it
      // intentionally and our resolver might guess differently.
      if (report.customerWasPlaceholder) {
        const customerResult = await resolveCustomer({
          channel: thread.channel,
          conversationKey: thread.conversationKey,
          participants: thread.participants,
          aiEntities: thread.aiEntities as Record<string, unknown> | null,
        });
        // Only switch if we found a real (non-auto-created) customer.
        // Otherwise we'd just shuffle placeholders, which is noise.
        if (customerResult && !customerResult.autoCreated) {
          update.payingCustomerId = customerResult.customerId;
          report.customerSet = true;
          report.customerName = customerResult.customerName;
          // The line items also carry payingCustomerId — keep them in sync.
          await prisma.ticketLine.updateMany({
            where: { ticketId: ticket.id, payingCustomerId: ticket.payingCustomerId },
            data: { payingCustomerId: customerResult.customerId },
          });
        }
      }

      // Site: fill only if blank.
      if (!ticket.siteId) {
        const siteId = await resolveSite(thread.aiEntities as Record<string, unknown> | null);
        if (siteId) {
          update.siteId = siteId;
          report.siteSet = true;
          const site = await prisma.site.findUnique({
            where: { id: siteId },
            select: { siteName: true },
          });
          report.siteName = site?.siteName;

          // Resolve and set siteCommercialLinkId if both customer + site present.
          const finalCustomerId = (update.payingCustomerId as string) ?? ticket.payingCustomerId;
          const link = await prisma.siteCommercialLink.findFirst({
            where: { customerId: finalCustomerId, siteId, isActive: true },
            select: { id: true },
          });
          if (link) {
            update.siteCommercialLinkId = link.id;
            report.siteCommercialLinkSet = true;
          }

          // Cascade to ticket lines that don't have a site set.
          await prisma.ticketLine.updateMany({
            where: { ticketId: ticket.id, siteId: null },
            data: { siteId, siteCommercialLinkId: link?.id ?? undefined },
          });
        }
      }

      if (Object.keys(update).length === 0) {
        result.skipped++;
        continue;
      }

      await prisma.ticket.update({ where: { id: ticket.id }, data: update });

      // Audit trail
      await prisma.event.create({
        data: {
          ticketId: ticket.id,
          eventType: "TICKET_BACKFILL_RESOLVED",
          timestamp: new Date(),
          notes: `Auto-resolved from inbox thread: ${[
            report.customerSet ? `customer → ${report.customerName}` : null,
            report.siteSet ? `site → ${report.siteName}` : null,
            report.siteCommercialLinkSet ? "siteCommercialLink linked" : null,
          ].filter(Boolean).join("; ")}`,
        },
      });

      result.updated.push(report);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ ticketId: ticket.id, error: msg });
      console.error(`[backfill-ticket-resolution] ${ticket.id}:`, err);
    }
  }

  return result;
}
