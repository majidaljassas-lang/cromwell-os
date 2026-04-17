/**
 * Correction: the core drill hire is a COMPANY-WIDE HIRE for Criterion Capital,
 * not a site-scoped job. The drill floated across wherever Criterion needed it.
 * "Trocadero Loading Bay" was only the physical drop-off spot for the 2026-02-06
 * off-hire — not a commercial site.
 *
 * Actions:
 *   1. Ticket → ticketMode = NON_SITE; clear siteId + siteCommercialLinkId
 *   2. TicketLines → clear siteId + siteCommercialLinkId
 *   3. Delete SiteContactLink (Gilbey↔Trocadero↔Capital) we created
 *   4. Delete SiteCommercialLink (Trocadero↔Capital) we created
 *   5. Delete Site Trocadero Loading Bay (not a real commercial site)
 *   6. Update ticket description to reflect company-wide hire
 *   7. Update 2026-02-06 Event notes to mention drop-off location without site coupling
 */

import prismaPkg from '../src/generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import 'dotenv/config';

const { PrismaClient } = prismaPkg;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const p = new PrismaClient({ adapter });

const TICKET_ID = '4c30dc62-d980-46a6-86b3-399e57b6fd35';
const SITE_ID = 'a565c8d8-21aa-42d8-b383-7b75c1dcf220';
const SITE_COMMERCIAL_LINK_ID = '8ca02866-535e-4a25-94d9-f95088a08d46';
const SITE_CONTACT_LINK_ID = '5565b300-4818-4fa0-88d3-d81dc2002930';

async function main() {
  // 1+2. Decouple ticket + lines from the site
  await p.ticket.update({
    where: { id: TICKET_ID },
    data: {
      ticketMode: 'NON_SITE',
      siteId: null,
      siteCommercialLinkId: null,
      description:
        'COMPANY-WIDE HIRE for Criterion Capital (group). Not site-scoped.\n' +
        'Rob Gilbey requested two core drill hires from Cromwell Plumbing over Oct–Dec 2025; Cromwell pass-through hired from Online Tool Hire (contact: Renaldas). No customer PO raised. The drill floated across multiple Criterion sites over the hire period — no single project site is the "home" of the hire.\n' +
        'One drill was collected and off-hired on 2026-02-06 at Trocadero Loading Bay (a drop-off location only, not a commercial site); handle + fixing bar missing. One drill still out; planned off-hire 2026-04-20, collection 2026-04-21.\n' +
        'Quote addressed to Criterion Capital at group level. The subsidiary that issues the PO becomes the invoice billing entity; reporting rolls up to Capital. Possible issuing entities: Criterion Capital, Criterion Developments, London Trocadero (2015) LLP, Baker Street (2015) LLP.\n' +
        'Schema gap: no dedicated Hire/Asset/Movement model — modelled as PLANT TicketLines + Events for now. See feedback_hire_is_feature memory. Company-wide hires pin ticketMode = NON_SITE.',
    },
  });

  await p.ticketLine.updateMany({
    where: { ticketId: TICKET_ID },
    data: { siteId: null, siteCommercialLinkId: null },
  });

  // 3. Delete the SiteContactLink
  await p.siteContactLink.delete({ where: { id: SITE_CONTACT_LINK_ID } }).catch(() => {});

  // 4. Delete the SiteCommercialLink (only if no other references remain)
  await p.siteCommercialLink.delete({ where: { id: SITE_COMMERCIAL_LINK_ID } }).catch((e) => {
    console.warn('Could not delete SiteCommercialLink:', e.message);
  });

  // 5. Delete the Site (only if nothing else references it)
  await p.site.delete({ where: { id: SITE_ID } }).catch((e) => {
    console.warn('Could not delete Site Trocadero Loading Bay (likely other references):', e.message);
  });

  // 6. Update the 2026-02-06 Event to reflect drop-off only, not site coupling
  await p.event.updateMany({
    where: { ticketId: TICKET_ID, sourceRef: 'OTH-offhire-2026-02-06' },
    data: {
      notes:
        'One drill collected and off-hired on 2026-02-06. Drop-off location: Trocadero Loading Bay (a drop-off spot — NOT the site of any specific Criterion project; the hire is company-wide). Handle + fixing bar missing; photo on Majid 2026-04-14 email. Drill identity (Hire #1 or #2) TBC with Renaldas.',
    },
  });

  // 7. Update SiteContactLink on Rob Gilbey — he's still a Criterion Capital contact,
  //    but not linked to a site for this ticket. Leave his other SiteContactLinks alone.

  // Summary
  const t = await p.ticket.findUnique({
    where: { id: TICKET_ID },
    select: { id: true, ticketNo: true, ticketMode: true, siteId: true, siteCommercialLinkId: true, payingCustomerId: true, scopeType: true },
  });
  const lineCount = await p.ticketLine.count({ where: { ticketId: TICKET_ID } });
  const eventCount = await p.event.count({ where: { ticketId: TICKET_ID } });
  const taskCount = await p.task.count({ where: { ticketId: TICKET_ID, status: { not: 'COMPLETED' } } });
  console.log(JSON.stringify({ ticket: t, lineCount, eventCount, taskCount }, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await p.$disconnect(); await pool.end(); });
