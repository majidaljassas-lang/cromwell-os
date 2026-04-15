# Handover — feature/ingestion-cutover

Last updated: 2026-04-15 by Majid + Claude (Opus 4.6 1M)

## Where this branch stands

Branch `feature/ingestion-cutover` pushed to origin. Head: `7f88339`.

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

## WhatsApp backfill run — BLOCKED on whatsapp-web.js Store warm-up

Triggered `POST /api/ingest/whatsapp/backfill` twice post-restart:

| Attempt | Wait before trigger | chatsTotal | chatsScanned | messagesIngested | errors |
|---|---|---|---|---|---|
| 1 | ~0s after ready | 920 | 920 | 0 | 920 |
| 2 | ~50s after ready | 920 | 920 | 0 | 920 |

Every chat threw the same error inside puppeteer:
```
Cannot read properties of undefined (reading 'waitForChatLoading')
  at ...static.whatsapp.net/rsrc.php/.../ncxg1Zqzonb.js:2085:1607
```

This is a whatsapp-web.js Store-warm-up issue. `client.on("ready")` fires before WhatsApp Web's internal `Store.Chat` is fully hydrated, so `chat.fetchMessages()` blows up on an undefined method. Live `message_create` events work fine because they don't call `fetchMessages`. Time alone doesn't fix it — the Store won't populate until the page is nudged.

**Known workarounds (pick one before the next attempt):**
1. In `scripts/whatsapp-qr-server.js` `runBackfill`, before iterating chats call `await client.pupPage.evaluate(() => window.Store.Chat.getModelsArray());` to force-hydrate the Chat collection. Then retry fetchMessages.
2. For each chat, `await client.getChatById(chat.id._serialized)` before `fetchMessages` — this forces the UI to open/load that chat in the background page.
3. If neither works, swap the backfill loop for `client.pupPage.evaluate` that pulls `window.Store.Msg.models` filtered by chat + timestamp directly, bypassing the high-level API. Heavier rewrite.

Option 2 is the cleanest next step. Implementation sketch:
```js
for (const chat of chats) {
  const hydrated = await client.getChatById(chat.id._serialized);
  const messages = await hydrated.fetchMessages({ limit });
  ...
}
```

**Check status any time:**
```bash
curl -sS http://localhost:3000/api/ingest/whatsapp/backfill | jq
```

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
