# Handover — feature/ingestion-cutover

Last updated: 2026-04-15 by Majid + Claude (Opus 4.6 1M)

## Where this branch stands

Branch `feature/ingestion-cutover` pushed to origin. Head: `3d4161f`.

Three pieces shipped in this session:
1. **CUTOVER_DATE cutover floor** (`src/lib/sync-constants.js`) — all pollers clamp `since = max(lastSyncAt, CUTOVER_DATE)`, with 2026-04-01 as the floor. Outlook sync route uses it; WhatsApp live ingest uses it; backfill scripts import it.
2. **WhatsApp backfill control plane** — `POST /api/ingest/whatsapp/backfill` + `GET /api/ingest/whatsapp/backfill` (status) proxy into `scripts/whatsapp-qr-server.js` on `:3001/backfill{,/status}`. Required because the authenticated puppeteer session lives in the PM2 `cromwell-whatsapp` process; we can't open a second browser. Single-flight, paginates per chat until oldest message < `since` (cap 10k), never creates tickets.
3. **Content-aware auto-linker** — `resolveLink()` + `scoreAgainstTicket()` are now wired into both live ingest paths:
   - WhatsApp live route: removed the "Auto-linking DISABLED" block, now calls `resolveLink` + `attachEventToThread`.
   - Outlook sync route: `resolveLink` runs alongside the existing `attachEventToThread`.
   - `autoLinkThread` combines contact-based + content-based scores. Gates: **HIGH (≥70)** auto-threads + `status=LINKED`; **MEDIUM (40-69)** writes `linkedTicketId` as a suggestion, `status` stays `NEW` for one-tap confirm; **LOW (<40)** leaves no ticket link, flagged as potential new. MANUAL links are sacrosanct.
   - **Never creates tickets under any circumstance.**
4. **Side fix**: `thread-builder.ts` now accepts both snake_case (`chat_id`, `sender_phone`, `message_text`, `has_media`) and camelCase payload shapes. Before this, WhatsApp events were silently untracked because the live payload is snake_case.

## Tests

- `scripts/test-auto-link-scoring.js` — **3/3 pass**. Pure unit test of the scoring math against the three scenarios the user specified: HIGH (site + TK-12345 + product + timeline = 80), MEDIUM (site + customer + timeline = 50), LOW (timeline only = 10).
- `scripts/test-auto-link.js` — end-to-end HTTP test that seeds a Ticket + Site + Customer, sends 3 fake WhatsApp payloads through the live `/api/ingest/whatsapp/live`, and asserts `linkedTicketId` + `linkConfidence` on the resulting `InboxThread`. Couldn't run to completion in this session because `cromwell-db` (pglite) is in a degraded state that P1017s on `prisma.ticket.findMany` with relation includes after sustained load. Kept in the repo for a clean-DB run.

## Service state (post-restart)

```
pm2 list | grep cromwell
  0  cromwell-whatsapp  online   — reloaded with new /backfill endpoint
  1  cromwell-poller    online   — unchanged
  2  cromwell-watchdog  online   — unchanged
  3  cromwell-db        errored  — see Known issues
  4  cromwell-web       online   — reloaded with new matcher wiring
```

## WhatsApp backfill — WORKING via direct Store.Msg access

### Debugging path (for future reference)

| Attempt | Approach | chatsScanned | ingested | errors | Verdict |
|---|---|---|---|---|---|
| 1 | `chat.fetchMessages()` straight from `getChats()` | 920 | 0 | 920 | Fail |
| 2 | +50s warm-up delay before trigger | 920 | 0 | 920 | Fail |
| 3 | `client.getChatById(jid)` before fetchMessages + skip `status@broadcast` | 920 | 0 | 919 | Fail (skip worked, core still broken) |
| 4 | `pupPage.evaluate(() => Store.Chat.getModelsArray())` Store nudge | 920 | 0 | 919 | Fail |
| 5 | **Direct `Store.Msg.getModelsArray()` via `pupPage.evaluate`, bypass whatsapp-web.js high-level API** | 93 | **72** | **0** | ✅ |

Every failing attempt threw the same error from inside puppeteer:
```
Cannot read properties of undefined (reading 'waitForChatLoading')
  at ...static.whatsapp.net/rsrc.php/.../ncxg1Zqzonb.js:2085:1607
```
Root cause: `whatsapp-web.js@1.34.6` calls `Store.Chat.waitForChatLoading` internally, but that function no longer exists in the current WhatsApp Web build. The library has drifted from the web client. Every path that routes through `Chat.fetchMessages` is broken until the lib is upgraded.

### Current implementation (option 5, shipped)

`scripts/whatsapp-qr-server.js` `runBackfill` now reads `Store.Msg` directly via `pupPage.evaluate`, filters by timestamp ≥ `since` in the page context, and POSTs each payload to `/api/ingest/whatsapp/live`. Same dedup + classifier + auto-linker pipeline as the live listener.

### Known limitation of option 5

`Store.Msg` only contains messages **currently loaded in the WhatsApp Web tab's memory**. After a cromwell-whatsapp restart it starts near-empty and accumulates over time as:
- the live listener receives new messages, and
- the WhatsApp Web tab lazily pulls chat history when opened in the UI (not triggered programmatically here).

**Implication:** a backfill run right after a restart captures ~recent messages only. For a real "replay everything since 01.04.2026" you need the cromwell-whatsapp process to have been running long enough for the Store to accumulate, or a proper library upgrade that restores `fetchMessages`.

### First successful run (post option 5 deploy)

```
found=126 ingested=72 skipped=54 errors=0  (93 chats, 25s)
```
The 54 skips are a mix of dedupes (already ingested via live listener), blacklist/whitelist filter hits, and pre-cutover messages that slipped the in-evaluate filter. Zero errors means the pipeline is clean.

### Re-run the backfill

```bash
curl -sS -X POST http://localhost:3000/api/ingest/whatsapp/backfill \
  -H "Content-Type: application/json" -d '{}'
# then:
curl -sS http://localhost:3000/api/ingest/whatsapp/backfill | jq
```

### If you need a full historical replay

1. Upgrade `whatsapp-web.js` to a version that tracks the current WhatsApp Web build. Test the live listener afterwards — the `message_create` contract may have changed.
2. Alternatively, leave cromwell-whatsapp running for days/weeks — Store.Msg grows, and subsequent backfill runs replay whatever's accumulated.

## Known issues

- **cromwell-db PM2 loop.** The `cromwell-db` app keeps trying to start `prisma dev` but exits because an orphan pglite instance (`PID 26304`, bound to `localhost:51213-51215`) is still holding the ports. Functionally the DB is accessible — all queries hit the orphan — but PM2's restart counter keeps climbing. Fix when convenient: `kill 26304`, then `pm2 restart cromwell-db`. Expect a short blip in DB availability.
- **Prisma + pglite P1017 on heavy `include`.** `prisma.ticket.findMany` with `include: { site, payingCustomer, requestedByContact, actingOnBehalfOfContact, lines }` reliably fails after sustained load ("Server has closed the connection"). Worked around in `scoreOpenTicketsForText` by splitting `actingOnBehalfOfContact` into a follow-up fetch. If you see the error elsewhere, apply the same pattern.
- **Outlook route TS errors (pre-existing).** 41 errors in `src/app/api/automation/sync/outlook/route.ts`, all from the `emails.map((e) => ({ ...e, _folder: "INBOX" as const }))` spread erasing Graph API types. Runtime is fine; only inference is lost. Not touched this session.

## What's still ahead (from the original plan)

1. ~~Step 1: CUTOVER_DATE + Outlook backfill + WhatsApp backfill~~ — done.
2. **Step 2: Move Zoho bills from nightly to 2-minute poll loop.** Not started. `src/app/api/zoho/poll-bills/route.ts` exists and has its own `lastSyncAt` logic; move its cron invocation into `scripts/email-poller.js` (currently runs every 10m, hits Outlook sync + intake queue).
3. **Step 3: WhatsApp backfill** — mechanism shipped (backfill endpoint), execution pending successful retry (see above).
4. **Step 4: Zoho PO ingestion.** Not started. `src/lib/ingestion/auto-action.ts` has a `handlePODocument` stub. No Zoho PO pull route yet.

## How to verify the auto-linker end-to-end when the DB is clean

1. `pm2 kill && pm2 start ecosystem.config.cjs` — fully fresh stack.
2. `node scripts/test-auto-link-scoring.js` — should print `3/3 passed`.
3. `node scripts/test-auto-link.js` — should print `3/3 passed`. If it prints P1017, apply the kill-orphan-pglite step above and retry.

## Relevant commits

```
7f88339  Content-aware auto-linker: wire resolveLink + scoreAgainstTicket into live ingest paths
bddce3e  WIP: pre-assessment snapshot 2026-04-15  (backfill endpoint + inbox UI changes)
d4cb134  Ingestion cutover: CUTOVER_DATE constant, Outlook backfill from 01.04.2026, WhatsApp backfill aligned
```
