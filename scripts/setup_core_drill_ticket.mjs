/**
 * Bootstrap the core drill hire ticket for Rob Gilbey (Criterion Capital) ×
 * Online Tool Hire (Renaldas). Idempotent: re-running is safe.
 *
 * Timeline (from Majid's 2026-04-14 email to Risheek Mamilapalli):
 *   2025-10-27  Rob WhatsApp requests drill #1
 *   2025-10-28  Hire #1 starts
 *   2025-12-01  Rob WhatsApp requests drill #2
 *   2025-12-03  Hire #2 starts
 *   2026-02-06  One drill off-hired at Trocadero Loading Bay (handle + fixing bar missing)
 *   2026-04-17  Chaser email — still one drill outstanding, no PO
 *   2026-04-20  Planned off-hire of remaining drill
 *   2026-04-21  Planned collection
 *
 * Primary site: Trocadero Loading Bay. Drill moved across multiple Criterion
 * sites over the hire period — recorded in ticket description and Events.
 *
 * Customer hierarchy: Criterion Capital (parent) — quote goes here. When a PO
 * arrives from a subsidiary (Developments, London Trocadero (2015) LLP etc.)
 * the invoicing customer is swapped to that sub; P&L still rolls up to Capital.
 */

import prismaPkg from '../src/generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import 'dotenv/config';

const { PrismaClient } = prismaPkg;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const p = new PrismaClient({ adapter });

const CRITERION_CAPITAL_ID = 'criterion-capital';
const ROBERT_GILBEY_ID = '2eca4595-551e-4c2b-b8ba-90353b3e4ade';
const MAJID_EMAIL_EVENT_ID = 'dd11aa3e-d6d7-4138-9b3e-0f55cd7e26fb';

async function main() {
  // 1. Online Tool Hire supplier (create if missing)
  let oth = await p.supplier.findFirst({
    where: { name: { contains: 'Online Tool Hire', mode: 'insensitive' } },
  });
  if (!oth) {
    oth = await p.supplier.create({
      data: {
        name: 'Online Tool Hire',
        legalName: null,
        email: null,
        phone: null,
        notes: 'Plant/tool hire supplier. Primary contact: Renaldas. Added 2026-04-17 for core-drill-hire ticket (Rob Gilbey / Criterion Capital).',
      },
    });
    // Alias OTH
    await p.supplierAlias.upsert({
      where: { supplierId_alias: { supplierId: oth.id, alias: 'OTH' } },
      update: {},
      create: { supplierId: oth.id, alias: 'OTH', source: 'USER', observationCount: 1, lastSeenAt: new Date() },
    });
  }
  console.log('Supplier Online Tool Hire:', oth.id);

  // 2. Trocadero Loading Bay site (create if missing) — primary hire site
  let site = await p.site.findFirst({
    where: { siteName: { contains: 'Trocadero', mode: 'insensitive' } },
  });
  if (!site) {
    site = await p.site.create({
      data: {
        siteName: 'Trocadero Loading Bay',
        siteCode: 'TROCADERO',
        aliases: ['London Trocadero', 'Trocadero', 'London Trocadero (2015) LLP'],
        notes: 'Primary site for core-drill-hire ticket (Rob Gilbey). The drill moved across multiple Criterion sites over the hire period — this site is where the 2026-02-06 off-hire and the planned 2026-04-21 collection occur. Owned under London Trocadero (2015) LLP per Criterion PROPCO correspondence.',
        isActive: true,
      },
    });
  }
  console.log('Site Trocadero Loading Bay:', site.id);

  // 3. SiteCommercialLink — Trocadero ↔ Criterion Capital (PayingCustomer)
  let link = await p.siteCommercialLink.findFirst({
    where: { siteId: site.id, customerId: CRITERION_CAPITAL_ID, role: 'PayingCustomer' },
  });
  if (!link) {
    link = await p.siteCommercialLink.create({
      data: {
        siteId: site.id,
        customerId: CRITERION_CAPITAL_ID,
        role: 'Client',
        billingAllowed: true,
        defaultBillingCustomer: true,
        isActive: true,
        commercialNotes: 'Criterion Capital is the group parent (quote addressee). The subsidiary that issues the PO — potentially London Trocadero (2015) LLP, Criterion Developments, or another sub — becomes the invoice billing entity; reporting rolls up to Capital via parentCustomerEntityId.',
      },
    });
  }
  console.log('SiteCommercialLink Trocadero → Criterion Capital:', link.id);

  // 4. SiteContactLink — Robert Gilbey ↔ Trocadero ↔ Criterion Capital
  let contactLink = await p.siteContactLink.findFirst({
    where: { siteId: site.id, contactId: ROBERT_GILBEY_ID, customerId: CRITERION_CAPITAL_ID },
  });
  if (!contactLink) {
    contactLink = await p.siteContactLink.create({
      data: {
        siteId: site.id,
        contactId: ROBERT_GILBEY_ID,
        customerId: CRITERION_CAPITAL_ID,
        siteCommercialLinkId: link.id,
        roleOnSite: 'ProjectManager',
        isPrimary: true,
        isActive: true,
      },
    });
  }
  console.log('SiteContactLink Gilbey → Trocadero → Capital:', contactLink.id);

  // 5. Ticket — backdated to the first WhatsApp request on 2025-10-27
  let ticket = await p.ticket.findFirst({
    where: { title: { contains: 'Core drill hire', mode: 'insensitive' }, payingCustomerId: CRITERION_CAPITAL_ID },
  });
  if (!ticket) {
    ticket = await p.ticket.create({
      data: {
        title: 'Core drill hire (multi-site) — Criterion Capital (Gilbey)',
        description:
          'Cross-cutover hire ticket.\n' +
          'Rob Gilbey requested two core drill hires from Cromwell Plumbing over Oct–Dec 2025; Cromwell pass-through hired from Online Tool Hire (contact: Renaldas). No customer PO was raised. One drill returned 2026-02-06 at Trocadero Loading Bay (handle + fixing bar missing). One drill still out; planned off-hire 2026-04-20, collection 2026-04-21.\n' +
          'Drill moved across multiple Criterion sites during the hire period — each known location will be logged as an Event on this ticket. Trocadero Loading Bay is the primary site for off-hire/collection.\n' +
          'Quote to be addressed to Criterion Capital (group). The subsidiary that issues the PO becomes the invoice billing entity; reporting rolls up to Capital. Possible issuing entities: Criterion Capital itself, Criterion Developments, London Trocadero (2015) LLP, Baker Street (2015) LLP.\n' +
          'Schema gap: no dedicated Hire/Asset/Movement model — modelled as PLANT TicketLines + Events for now. See feedback_hire_is_feature memory.',
        ticketMode: 'DIRECT_ORDER',
        status: 'CAPTURED',
        scopeType: 'CROSS_CUTOVER_HIRE',
        payingCustomerId: CRITERION_CAPITAL_ID,
        siteId: site.id,
        siteCommercialLinkId: link.id,
        requestedByContactId: ROBERT_GILBEY_ID,
        quoteRequired: true,
        quoteStatus: null, // no quote drafted yet
        poRequired: true,
        poStatus: 'AWAITING_PO',
        recoveryRequired: true,
        revenueState: 'OPERATIONAL',
        source: 'WHATSAPP',
        sourceRef: 'Rob Gilbey WhatsApp 2025-10-27',
        createdAt: new Date('2025-10-27T12:00:00Z'),
        manualMode: true, // stops AI/auto from retro-editing this carefully hand-built ticket
      },
    });
  }
  console.log('Ticket:', ticket.id, '#' + ticket.ticketNo);

  // 6. TicketLines — one per hire episode (2 drills)
  const existingLines = await p.ticketLine.findMany({ where: { ticketId: ticket.id } });
  if (existingLines.length === 0) {
    await p.ticketLine.create({
      data: {
        ticketId: ticket.id,
        lineType: 'PLANT',
        description: 'Core drill hire #1 — Rob Gilbey request 27 Oct 2025; hire started 28 Oct 2025. Off-hire/return date TBC — one of the two drills was returned at Trocadero Loading Bay on 2026-02-06 (handle + fixing bar missing), confirm which drill.',
        qty: 1,
        unit: 'EA',
        siteId: site.id,
        siteCommercialLinkId: link.id,
        payingCustomerId: CRITERION_CAPITAL_ID,
        requestedByContactId: ROBERT_GILBEY_ID,
        supplierId: oth.id,
        supplierName: 'Online Tool Hire',
        supplierStrategyType: 'DIRECT_PASSTHROUGH',
        status: 'CAPTURED',
        sectionLabel: 'HIRE_EPISODE_1',
        internalNotes: 'PLANT/hire line. Cost writeback expects OTH bill lines with hire-day rates × days on hire. Sale price = manual (no auto-markup per close_loops_only).',
      },
    });
    await p.ticketLine.create({
      data: {
        ticketId: ticket.id,
        lineType: 'PLANT',
        description: 'Core drill hire #2 — Rob Gilbey request 1 Dec 2025; hire started 3 Dec 2025. Still on hire as of 2026-04-17; planned off-hire 2026-04-20 and collection 2026-04-21. Final OTH bill expected after collection.',
        qty: 1,
        unit: 'EA',
        siteId: site.id,
        siteCommercialLinkId: link.id,
        payingCustomerId: CRITERION_CAPITAL_ID,
        requestedByContactId: ROBERT_GILBEY_ID,
        supplierId: oth.id,
        supplierName: 'Online Tool Hire',
        supplierStrategyType: 'DIRECT_PASSTHROUGH',
        status: 'CAPTURED',
        sectionLabel: 'HIRE_EPISODE_2',
        internalNotes: 'PLANT/hire line. Final OTH bill expected 2026-04-21+ — placeholder cost via expectedCostTotal once day-rate is confirmed with Renaldas. Sale price = manual.',
      },
    });
  }
  const lines = await p.ticketLine.findMany({ where: { ticketId: ticket.id }, orderBy: { createdAt: 'asc' } });
  console.log('TicketLines:', lines.map((l) => `${l.sectionLabel}: ${l.id}`).join(' | '));
  const [line1, line2] = lines;

  // 7. Events — hire lifecycle milestones
  const eventSpecs = [
    { eventType: 'ORDER_PLACED', timestamp: '2025-10-27T09:00:00Z', notes: 'Rob Gilbey WhatsApp: requested 1 core drill hire. Cromwell to arrange via Online Tool Hire.', ticketLineId: line1.id, sourceRef: 'WA:rob-gilbey-2025-10-27' },
    { eventType: 'ORDER_PLACED', timestamp: '2025-10-28T09:00:00Z', notes: 'Hire #1 starts — core drill issued by Online Tool Hire (Renaldas).', ticketLineId: line1.id, sourceRef: 'OTH-hire-start-1' },
    { eventType: 'ORDER_PLACED', timestamp: '2025-12-01T09:00:00Z', notes: 'Rob Gilbey WhatsApp: requested 2nd core drill hire.', ticketLineId: line2.id, sourceRef: 'WA:rob-gilbey-2025-12-01' },
    { eventType: 'ORDER_PLACED', timestamp: '2025-12-03T09:00:00Z', notes: 'Hire #2 starts — second core drill issued by Online Tool Hire.', ticketLineId: line2.id, sourceRef: 'OTH-hire-start-2' },
    { eventType: 'RETURN_CREATED', timestamp: '2026-02-06T12:00:00Z', notes: 'One drill collected and off-hired at Trocadero Loading Bay (handle + fixing bar missing; photo on Majid 2026-04-14 email). Drill identity (Hire #1 or #2) TBC.', ticketLineId: null, sourceRef: 'OTH-offhire-2026-02-06' },
    { eventType: 'PO_FOLLOWUP_SENT', timestamp: '2026-04-14T09:44:43Z', notes: 'Majid emailed Risheek Mamilapalli (Criterion Capital) with the full core-drill trail and URGENT ACTION NEEDED. Chase for PO. Mohammed Yusuf, Rob and Wahid Mahari all know.', ticketLineId: null, sourceRef: MAJID_EMAIL_EVENT_ID },
  ];
  for (const spec of eventSpecs) {
    const existing = await p.event.findFirst({ where: { ticketId: ticket.id, sourceRef: spec.sourceRef } });
    if (!existing) {
      await p.event.create({
        data: {
          ticketId: ticket.id,
          ticketLineId: spec.ticketLineId,
          eventType: spec.eventType,
          timestamp: new Date(spec.timestamp),
          sourceRef: spec.sourceRef,
          notes: spec.notes,
        },
      });
    }
  }
  const events = await p.event.count({ where: { ticketId: ticket.id } });
  console.log('Events on ticket:', events);

  // 8. EvidenceFragment — Majid's 2026-04-14 email
  const existingEvidence = await p.evidenceFragment.findFirst({
    where: { ticketId: ticket.id, sourceRef: MAJID_EMAIL_EVENT_ID },
  });
  if (!existingEvidence) {
    await p.evidenceFragment.create({
      data: {
        ticketId: ticket.id,
        sourceType: 'OUTLOOK',
        sourceRef: MAJID_EMAIL_EVENT_ID,
        timestamp: new Date('2026-04-14T09:44:43Z'),
        fragmentType: 'DISPUTE',
        fragmentText: 'Majid → Risheek Mamilapalli (Criterion Capital), 2026-04-14 09:44. Subject: "Core Drill Trail - URGENT ACTION NEEDED". Full timeline of the two hires, the 2026-02-06 off-hire at Trocadero (handle + fixing bar missing, photo attached), and the still-outstanding drill. Cost chase, no PO. Primary dispute/recovery evidence.',
        sourceContactId: null,
        isPrimaryEvidence: true,
        confidenceScore: 100,
      },
    });
  }
  const evidenceCount = await p.evidenceFragment.count({ where: { ticketId: ticket.id } });
  console.log('EvidenceFragments:', evidenceCount);

  // 9. Tasks — Monday/Tuesday/follow-up actions
  const taskSpecs = [
    { taskType: 'OFF_HIRE_CONFIRM', priority: 'HIGH', status: 'OPEN', dueAt: '2026-04-20T09:00:00Z', generatedReason: 'Confirm off-hire of remaining core drill with Renaldas @ Online Tool Hire. Monday morning.', draftBody: 'Hi Renaldas,\n\nConfirming off-hire today (Monday 20 April 2026) for the remaining core drill from Cromwell Plumbing hire (ref Rob Gilbey / Criterion). Collection scheduled Tuesday 21 April 2026.\n\nPlease acknowledge the off-hire date for final billing.\n\nThanks,\nMajid' },
    { taskType: 'COLLECTION_CONFIRM', priority: 'HIGH', status: 'OPEN', dueAt: '2026-04-21T17:00:00Z', generatedReason: 'Confirm drill collection by Online Tool Hire — Tuesday. Closes Hire #2 lifecycle.' },
    { taskType: 'AWAIT_SUPPLIER_BILL', priority: 'MEDIUM', status: 'OPEN', dueAt: '2026-04-24T12:00:00Z', generatedReason: 'Awaiting final OTH bill for Hire #2 (collection 2026-04-21). Auto-closes when bill lands and match-bills wires it to TicketLine #2.', ticketLineId: line2.id },
    { taskType: 'SEND_QUOTE_TO_CRITERION', priority: 'CRITICAL', status: 'OPEN', dueAt: '2026-04-22T12:00:00Z', generatedReason: 'Once final bill is matched and sale prices are keyed, generate quote PDF addressed to Criterion Capital (group). Cover email must cite all hire episodes + explicit PO request.' },
    { taskType: 'CHASE_PO_FROM_CRITERION', priority: 'HIGH', status: 'OPEN', dueAt: '2026-04-27T10:00:00Z', generatedReason: 'Chase Criterion for PO after quote is sent (quote+3 working days). PO-issuing subsidiary determines the invoice billing entity.' },
    { taskType: 'CLOSE_HIRE_LIFECYCLE', priority: 'MEDIUM', status: 'OPEN', dueAt: '2026-04-30T17:00:00Z', generatedReason: 'Closes once: final OTH bill matched + collection confirmed + quote sent + PO received + invoice drafted.' },
    { taskType: 'CLARIFY_DRILL_IDENTITY', priority: 'MEDIUM', status: 'OPEN', generatedReason: 'The drill that was off-hired on 2026-02-06 — was it Hire #1 (Oct 2025) or Hire #2 (Dec 2025)? Clarify with Renaldas / OTH ledger so TicketLine allocations are correct.' },
    { taskType: 'CAPTURE_SITE_MOVEMENTS', priority: 'LOW', status: 'OPEN', generatedReason: 'Drill went to various Criterion sites over the hire period. Capture each movement as an Event so we can split cost recovery by site if the PO-issuing subsidiary requires it. See feedback_hire_is_feature memory for the long-term schema direction.' },
  ];
  for (const spec of taskSpecs) {
    const existing = await p.task.findFirst({
      where: { ticketId: ticket.id, taskType: spec.taskType, status: { not: 'COMPLETED' } },
    });
    if (!existing) {
      await p.task.create({
        data: {
          ticketId: ticket.id,
          ticketLineId: spec.ticketLineId ?? null,
          taskType: spec.taskType,
          priority: spec.priority,
          status: spec.status,
          generatedReason: spec.generatedReason,
          draftBody: spec.draftBody ?? null,
          dueAt: spec.dueAt ? new Date(spec.dueAt) : null,
        },
      });
    }
  }
  const taskCount = await p.task.count({ where: { ticketId: ticket.id, status: { not: 'COMPLETED' } } });
  console.log('Open tasks:', taskCount);

  // 10. RecoveryCase — opens the recovery loop
  const existingCase = await p.recoveryCase.findFirst({ where: { ticketId: ticket.id } });
  if (!existingCase) {
    await p.recoveryCase.create({
      data: {
        ticketId: ticket.id,
        reasonType: 'NO_PO_ISSUED',
        recoveryStatus: 'EVIDENCE_BUILDING',
        openedAt: new Date('2026-04-14T09:44:43Z'),
        currentStageStartedAt: new Date(),
        nextAction: 'Confirm final OTH bill; key sale prices per line; generate quote to Criterion Capital.',
        stuckValue: 0,
      },
    });
  }

  console.log('\n=== READY ===');
  console.log(`Ticket #${ticket.ticketNo} created. Visit /tickets/${ticket.id}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await p.$disconnect(); await pool.end(); });
