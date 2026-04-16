<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version (16.2.2) has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Automation map (Phases 1-12, 2026-04-16)

External cron → `/api/scheduler` (5 min) and `/api/scheduler/daily-sweep` (07:00). Both require `x-scheduler-secret`. Every automation endpoint under `/api/automation/*` is secret-guarded; `run-all` and `trickle-down` forward the header. Every scheduled job wraps its work in `runJob()` which writes a `SchedulerLog` row with status + summary JSON.

## `/api/automation/run-all` — 16 steps in order

| # | Step | Purpose | Lib module |
|---|---|---|---|
| 1 | `outlookSync` | Pull new emails → IngestionEvent | existing |
| 2 | `backfillAttachments` | Download + parse PDFs for events missing them | existing |
| 3 | `bankDetailCheck` | **Phase 9** — fraud-detect bank-detail changes in supplier docs | `src/lib/suppliers/bank-detail-monitor.ts` |
| 4 | `threeWayMatch` | **Phase 2** — PO ↔ delivery ↔ bill reconciliation | `src/lib/finance/three-way-match.ts` |
| 5 | `deliveryTracker` | **Phase 3** — process LogisticsEvents, redelivery / address-conflict tasks | `src/lib/logistics/delivery-tracker.ts` |
| 6 | `addressChangeDetection` | **Phase 3** — scan InboxThreadMessages for postcodes differing from site | `src/lib/logistics/delivery-tracker.ts` |
| 7 | `miscommDetection` | **Phase 8** — cross-contact conflicting instructions; AI fallback | `src/lib/intelligence/miscomm-detector.ts` |
| 8 | `uninvoicedDeliveries` | **Phase 4** — find delivered TicketLines with no SalesInvoiceLine | `src/lib/finance/invoice-trigger.ts` |
| 9 | `surplusMatcher` | **Phase 6** — cross-ticket transfer opportunities for unresolved surplus | `src/lib/stock/surplus-matcher.ts` |
| 10 | `classify` | Classify PARSED events; WhatsApp NEEDS_TRIAGE bridge; stale NEEDS_TRIAGE backfill | existing |
| 11 | `aiAnalyse` | **Phase 12** — AI classify unanalysed InboxThreads via Claude; extract entities + summary | `src/lib/intelligence/ai-classifier.ts` |
| 12 | `threadLinker` | Re-score InboxThreads with null/LOW confidence against open tickets; phone-history fallback | `src/lib/inbox/thread-linker.ts` |
| 13 | `autoCreateTickets` | **Phase 12** — create Tickets + TicketLines from high-confidence AI-analysed threads | `src/lib/inbox/auto-ticket-creator.ts` |
| 14 | `autoAction` | Auto-action classified events (PO / ORDER / BILL_DOCUMENT) | existing |
| 15 | `processBills` | Standalone bill pipeline + inline 3-way match on newly created bills | existing + `three-way-match.ts` |
| 16 | `trickleDown` | ack-matcher → monitor-threads → auto-progress → evidence → tasks → match-bills | existing |

## Phase 12 — Autonomous intake (2026-04-16)

**Principle:** AI suggests, human decides. Nothing the AI does is irreversible.

### Pipeline flow

```
Email/WhatsApp arrives
  → IngestionEvent (step 1: outlookSync)
  → InboxThread (thread-builder.ts: attachEventToThread)
  → AI classification + entity extraction (step 11: aiAnalyse)
  → Thread-to-ticket linking (step 12: threadLinker)
  → Auto-create ticket if confidence ≥75 (step 13: autoCreateTickets)
  → Subsequent messages auto-append to linked ticket (thread-appender.ts)
```

### AI classifier (`src/lib/intelligence/ai-classifier.ts`)

- Uses Claude (via `src/lib/ai/anthropic.ts`) to classify InboxThreads
- Classifications: ORDER, QUOTE_REQUEST, COMPETITIVE_BID, SPEC_DRIVEN, APPROVAL, DELIVERY_UPDATE, BILL_DOCUMENT, DISPUTE, SCHEDULE, NOISE
- Returns structured JSON: classification, confidence (0-100), summary (20 words), entities (siteName, customerName, poRef, amounts, products, deliveryDate, contactIntent)
- Cost controls: skip if <20 chars, skip if manualMode=true, skip if analysed <24h ago with no new messages, skip if keyword confidence ≥80
- Fallback: keyword classifier if AI disabled or errors

### Auto-ticket creator (`src/lib/inbox/auto-ticket-creator.ts`)

- Processes threads where: status=NEW, unlinked, manualMode=false, aiConfidence ≥75, commercial classification
- Creates Ticket with autoCreatedByAi=true + TicketLines extracted by AI
- Line extraction: second Claude call extracts products with description/qty/unit from thread text
- Customer resolution: Contact→SiteContactLink→Customer, then AI name match, then email domain, then auto-create with (auto-intake) tag
- Site resolution: aiEntities.siteName fuzzy-matched against Site.siteName/aliases
- Creates REVIEW_AUTO_TICKET task (MEDIUM priority) for human review
- Confidence 50-74: no ticket, boost dealScore for inbox surfacing

### Thread appender (`src/lib/inbox/thread-appender.ts`)

- Wired into `attachEventToThread()` in `thread-builder.ts`
- When a new message lands on a thread with linkedTicketId: creates Event (COMMS_RECEIVED), EvidenceFragment if attachments, Task if signal detected (APPROVAL_RECEIVED, DISPUTE_FLAG, DELIVERY_UPDATE_RECEIVED)
- Respects manualMode on thread and ticket; skips closed/invoiced/locked tickets
- Idempotent: checks sourceRef before creating

### Manual override rules

- `InboxThread.manualMode` (Boolean, default false) — when true, AI never re-analyses or re-classifies
- `Ticket.manualMode` (Boolean, default false) — when true, automation never touches that ticket
- `linkSource = MANUAL` always wins — automation never overwrites manual links
- Auto-created tickets flagged with `autoCreatedByAi = true` — shown as "AI" badge in UI
- User can delete, edit, reassign, or promote any AI-created ticket

## `/api/scheduler/daily-sweep` — 11 categories at 07:00

Each category runs in its own try/catch; one failure does not abort the others. Results persist to `SchedulerLog.summary`.

1. `overdueDelivery` — POs ≥3d with no DELIVERED LogisticsEvent
2. `uninvoicedDeliveries` — delegates to `sweepUninvoicedDeliveries`
3. `chasePayment` — `SalesInvoice.dueDate` within next 5 days, unpaid
4. `paymentOverdue` — past dueDate unpaid; escalates to CRITICAL at 7d
5. `chaseCreditNote` — Returns ≥14d with expected credit, no CreditNote
6. `supplierDisputesAging` — `SupplierBill.matchStatus=DISPUTE` ≥3d → URGENT, ≥7d → CRITICAL
7. `miscommDetection` — delegates to `runMiscommDetection({sinceHours:96})`
8. `surplusMatching` — delegates to `runSurplusMatcher` (before aging so fresh matches pre-empt returns)
9. `surplusStockAging` — unresolved ≥7d → `SURPLUS_ACTION_REQUIRED`, ≥14d → `RETURN_TO_SUPPLIER`
10. `bankDetailSweep` — delegates to `runBankDetailSweep`
11. `bankDetailAlerts` — escalates any `BANK_DETAIL_CHANGE_ALERT` task ≥1d old to CRITICAL

## Lib modules built across Phases 1-12

| File | Purpose | Schema models touched |
|---|---|---|
| `src/lib/scheduler/runner.ts` | `runJob()` wrapper; writes SchedulerLog row per invocation | `SchedulerLog` |
| `src/lib/scheduler/secret.ts` | `checkSchedulerSecret` + `schedulerSecretHeaders` | — |
| `src/lib/scheduler/daily-sweep.ts` | 11-category morning sweep | reads many; writes `Task` |
| `src/lib/finance/three-way-match.ts` | PO ↔ delivery ↔ bill matcher | writes `SupplierBill.matchStatus`, creates `Task` SUPPLIER_DISPUTE |
| `src/lib/finance/invoice-trigger.ts` | uninvoiced-delivery sweep + billing-entity resolver | creates `Task` INVOICE_REQUIRED |
| `src/lib/logistics/delivery-tracker.ts` | LogisticsEvent processor + address-change detector | writes `LogisticsEvent.processedAt/deliveredAt`, `Ticket.deliveryFailed`, creates `Task` REDELIVERY_REQUIRED / ADDRESS_CONFLICT / ADDRESS_CHANGE_PENDING |
| `src/lib/stock/surplus-matcher.ts` | canonical-product resolution + cross-ticket match | writes `TicketLine.canonicalProductId`, `StockExcessRecord.canonicalProductId`, creates `Task` SURPLUS_MATCH_AVAILABLE |
| `src/lib/intelligence/miscomm-detector.ts` | conflict detector across InboxThreadMessages | writes `SiteContactLink.inferredRole`, creates `Task` MISCOMM_DETECTED |
| `src/lib/suppliers/bank-detail-monitor.ts` | fraud-detect bank changes in supplier docs | creates `Task` BANK_DETAIL_CHANGE_ALERT / STORE_BANK_DETAILS, writes `IngestionAuditLog` |
| `src/lib/intelligence/ai-classifier.ts` | **Phase 12** — Claude-powered thread classification + entity extraction | writes `InboxThread.aiClassification/aiConfidence/aiSummary/aiEntities/aiAnalysedAt` |
| `src/lib/inbox/auto-ticket-creator.ts` | **Phase 12** — auto-create Tickets + TicketLines from high-confidence threads | creates `Ticket`, `TicketLine`, `Task` REVIEW_AUTO_TICKET, `Event` TICKET_CREATED; writes `InboxThread.status=AUTO_TICKETED` |
| `src/lib/inbox/thread-appender.ts` | **Phase 12** — auto-append comms to linked tickets | creates `Event` COMMS_RECEIVED, `EvidenceFragment`, `Task` (signal-based) |

## Schema migrations applied

| Phase | Migration | Change |
|---|---|---|
| 1 | `20260415140000_phase_1_scheduler_log` | `SchedulerLog` table |
| 2 | `20260415150000_phase_2_three_way_match` | `BillMatchStatus` enum + SupplierBill.matchStatus/matchedAt/matchVarianceAmt/matchNotes, Task.supplierBillId + draftBody |
| 3 | `20260415160000_phase_3_delivery_tracking` | `LogisticsStopStatus` enum + LogisticsEvent.cpRef/stopStatus/plannedDate/driver/deliveryAddress/deliveredAt/processedAt, Ticket.deliveryFailed |
| 5 | `20260415170000_phase_5_sales_invoice_due_date` | SalesInvoice.dueDate |
| 6 | `20260415180000_phase_6_canonical_product_fks` | TicketLine.canonicalProductId, StockExcessRecord.canonicalProductId |
| 7 | `20260415190000_phase_7_legacy_orphan_enum` | InquiryStatus.LEGACY_ORPHAN |
| 8 | `20260415200000_phase_8_site_contact_inferred_role` | SiteContactLink.inferredRole |
| 9 | `20260415210000_phase_9_supplier_bank_fields` | Supplier.bankAccount/sortCode/iban/bankLastVerifiedAt/bankLastVerifiedBy |
| 12 | `20260416120000_phase_12_autonomous_intake` | InboxThread: aiClassification/aiConfidence/aiSummary/aiEntities/aiAnalysedAt/autoCreatedTicket/manualMode. Ticket: autoCreatedByAi/manualMode/aiSummary. InboxThreadStatus: AUTO_TICKETED. EventType: COMMS_RECEIVED/TICKET_CREATED |

## Deprecated — do not touch

- Backlog module (`BacklogCase`, `BacklogSourceGroup`, `BacklogSource`, `BacklogMessage`, `BacklogOrderThread`, `BacklogTicketLine`, `BacklogInvoiceDocument`, `BacklogCompleteness`) — protected by user instruction.
- `CommercialInvoice` — read-only Zoho mirror; writes return 410.
- `Enquiry` / `EnquiryTask` / `InquiryWorkItem` — legacy pipeline retired Phase 7. Writes return 410. Disposition route restricted to CLOSED / LEGACY_ORPHAN. `createEnquiry` in `commercialiser.ts` is a no-op.

## Command Centre

`/command-centre` is the default landing after login (root redirects there). Data API at `/api/command-centre`. System-level summary at `/api/system/health`.

## Known gaps (wiring not yet done)

- **`stopStatus` write-back** — no code currently parses supplier delivery emails to write `LogisticsEvent.stopStatus`. Delivery tracker + 3-way match will remain dormant until a writer is added (ack-matcher parses delivery confirmations today but only writes `eventType`; extending it to write `stopStatus` alongside is the natural hook).
- **Sidebar nav link** — root redirect goes to command-centre but the sidebar still shows "Dashboard" as the primary label. Cosmetic update.
- **Final migration consolidation** — each phase applied its own migration via `prisma db execute` (because `prisma dev` shadow DB returns P1017). Running `prisma migrate dev --name consolidate` would collapse them but is unnecessary and risks DB divergence.
- **AI badge in inbox UI** — `autoCreatedByAi` and `aiSummary` fields are persisted but the InboxThreadsPanel does not yet render the AI badge or summary. Cosmetic wiring.

## Phase 13 — Supplier quote auto-linking (NOT YET BUILT)

When a WhatsApp or email message arrives from a known supplier contact and contains prices/numbers, auto-link it to an open ticket in PRICING status and populate `TicketLinePrice` rows.

### Flow

1. **Detect**: WhatsApp/email lands in inbox. Sender matches a `Contact` linked to a `Supplier` via `SiteContactLink` or `SupplierAlias`.
2. **Extract**: AI or regex extracts line items with unit prices from the message body (same pattern as `auto-ticket-creator.ts` line extraction but for costs not orders).
3. **Match**: Find open tickets in `PRICING` or `CAPTURED` status where the ticket's lines overlap with the extracted items (description fuzzy match or `canonicalProductId`).
4. **Link**: For each matched ticket line, create a `TicketLinePrice` row with the supplier's name, cost per unit, and cost total. Run `recalcWinner()` to auto-select the best price.
5. **Surface**: Create a `Task` of type `SUPPLIER_QUOTE_RECEIVED` on the ticket so the user sees it in their task queue. Thread gets `linkConfidence: HIGH` and `linkedTicketId` set.

### Schema changes needed

- None — `TicketLinePrice` already supports this. `supplierId` FK links to the supplier.

### Lib module

- `src/lib/inbox/supplier-quote-linker.ts` — main engine
- Wired into `run-all` as step after `threadLinker`, before `autoCreateTickets`

### Constraints

- Only fires for messages from supplier-linked contacts (never customer contacts)
- Only targets tickets in PRICING / CAPTURED status (not ORDERED / INVOICED / CLOSED)
- Creates `TicketLinePrice` rows — never overwrites existing prices from other suppliers
- If match confidence is LOW, creates a `REVIEW_SUPPLIER_QUOTE` task instead of auto-linking
- Message text is preserved in `TicketLinePrice.notes` for audit trail

## Phase 14 — Stock Register (NOT YET BUILT)

Physical stock register tracking qty on hand per product. Stock depletes when allocated to ticket lines, replenishes from MOQ overages and returns. Visible on command centre dashboard.

### Core model

- `StockRegisterItem` — one row per distinct product held in stock
  - `canonicalProductId` (FK, nullable — linked when product is identified)
  - `description`, `productCode` (BES code, supplier SKU, etc.)
  - `qtyOnHand` — current physical quantity
  - `unit` (EA, M, LENGTH, PACK, etc.)
  - `avgCostPerUnit` — weighted average from purchase history
  - `totalCostValue` — qtyOnHand × avgCostPerUnit
  - `costConfirmed` — true if backed by a matched SupplierBill line, false if cost is estimated
  - `location` (warehouse, van, site — free text for now)
  - `lastCountedAt` — date of last physical count
  - `minQty` / `reorderQty` — optional reorder triggers

### Movements (audit trail)

- `StockMovement` — every in/out recorded with reason
  - `type`: `RECEIVED` | `ALLOCATED` | `RETURNED` | `ADJUSTED` | `TRANSFERRED`
  - `qty` (positive = in, negative = out)
  - `ticketLineId` — which job consumed it (for ALLOCATED)
  - `supplierBillLineId` — which bill brought it in (for RECEIVED)
  - `returnLineId` — link to return (for RETURNED)
  - `reason` — free text or auto-generated

### Depletion (ticket line → stock)

1. User marks ticket line as `FROM STOCK` (sets `fromStock > 0`)
2. System finds matching `StockRegisterItem` by `canonicalProductId` or `productCode`
3. Creates `StockMovement` type=ALLOCATED, decrements `qtyOnHand`
4. If `qtyOnHand` goes negative → creates `Task` STOCK_DISCREPANCY (more used than recorded)

### Replenishment

1. **MOQ overage**: when `TicketLine.qty` ordered > qty needed, excess flows to stock via `StockExcessRecord` → `StockRegisterItem` with type=RECEIVED
2. **Returns received**: supplier credit note processed → returned qty added back with type=RETURNED
3. **Manual adjustment**: physical count correction with type=ADJUSTED

### Cost confirmation

- When stock is used on a job (`fromStock > 0`), the system checks if the original purchase has a matched `SupplierBill` line
- If no bill match → `costConfirmed = false` → creates `Task` STOCK_COST_UNCONFIRMED
- Prevents margin calculation errors from estimated costs flowing into quotes/invoices

### Command centre integration

- **Stock value card**: total £ value of stock on hand
- **Unconfirmed cost alert**: count of items where `costConfirmed = false`
- **Low stock alerts**: items where `qtyOnHand < minQty`
- **Stock age**: items not allocated in 30+ days → candidates for return to supplier

### Constraints

- Stock register is Cromwell Plumbing only (not CF — CF has no physical stock)
- `StockItem` (existing model) tracks individual excess items per ticket; `StockRegisterItem` is the aggregate register across all jobs
- Never auto-deplete without user confirming `FROM STOCK` — no silent stock movements
- avgCostPerUnit recalculated on every RECEIVED movement using weighted average
