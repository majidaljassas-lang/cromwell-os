This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Scheduler setup

Automation runs via external cron hitting secret-guarded endpoints. Every
invocation is recorded in the `SchedulerLog` table (start/finish time, status,
summary JSON, error).

### 1. Generate a secret

```bash
openssl rand -hex 32
```

Add it to `.env`:

```
SCHEDULER_SECRET="<the hex string>"
```

### 2. Endpoints

Both expect `POST` with header `x-scheduler-secret: $SCHEDULER_SECRET`.

| Endpoint                         | Recommended cadence | Purpose                                                         |
| -------------------------------- | ------------------- | --------------------------------------------------------------- |
| `/api/scheduler`                 | every 5 minutes     | Fans out to `/api/automation/run-all` (sync, classify, bills …) |
| `/api/scheduler/daily-sweep`     | daily at 07:00      | Phase 5 ops sweep (overdue deliveries, chasers, disputes …)     |

### 3. Wire up a cron

**macOS / launchd** — `scripts/launchd/` already holds plist templates. Add
entries that run:

```bash
curl -X POST -H "x-scheduler-secret: $SCHEDULER_SECRET" \
  https://cromwell-os.internal/api/scheduler
```

**Vercel** — add to `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/scheduler",              "schedule": "*/5 * * * *" },
    { "path": "/api/scheduler/daily-sweep",  "schedule": "0 7 * * *" }
  ]
}
```

Vercel Cron sends a `Authorization: Bearer $CRON_SECRET` header, so for Vercel
deploys either set `SCHEDULER_SECRET` to match Vercel's `CRON_SECRET` and pass
it through your edge config, or add a small adapter route that translates the
Bearer header.

**Railway** — use Railway Cron service with the `curl` command above.

**Local development** — a plain crontab entry works:

```
*/5 * * * * curl -sS -X POST -H "x-scheduler-secret: $SCHEDULER_SECRET" http://localhost:3000/api/scheduler >> /tmp/cromwell-scheduler.log 2>&1
0 7  * * * curl -sS -X POST -H "x-scheduler-secret: $SCHEDULER_SECRET" http://localhost:3000/api/scheduler/daily-sweep >> /tmp/cromwell-sweep.log 2>&1
```

### 4. Observability

```sql
-- recent runs
SELECT job, status, "startedAt", "finishedAt",
       EXTRACT(EPOCH FROM ("finishedAt" - "startedAt")) AS seconds,
       error
FROM "SchedulerLog"
ORDER BY "startedAt" DESC
LIMIT 50;
```

A `RUNNING` row older than a couple of minutes means the job crashed without
finishing the `try/catch` wrapper — Phase 5's sweep will flag these.
