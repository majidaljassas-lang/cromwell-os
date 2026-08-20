import Link from "next/link";
import { getIntakeHealthSnapshot, type IntakeHealthSnapshot, type PollerStatus } from "@/lib/scheduler/heartbeat-monitor";

export const dynamic = "force-dynamic";

const POLLER_COLOUR: Record<PollerStatus, { bg: string; border: string; text: string; label: string }> = {
  HEALTHY: { bg: "bg-[#0F2A14]", border: "border-[#1F8F3A]", text: "text-[#1F8F3A]", label: "HEALTHY" },
  STALE: { bg: "bg-[#2A220A]", border: "border-[#FF9900]", text: "text-[#FF9900]", label: "STALE" },
  DEAD: { bg: "bg-[#2A0A0A]", border: "border-[#FF3333]", text: "text-[#FF3333]", label: "DEAD" },
};

function formatAge(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m ago`;
}

function StatusCount({ label, value, accent = "#CCCCCC" }: { label: string; value: number; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-[#1A1A1A] py-1.5">
      <span className="text-[10px] tracking-widest text-[#888888] bb-mono">{label}</span>
      <span className="text-sm bb-mono" style={{ color: accent }}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function QueueCard({
  title,
  rows,
  accentMap,
}: {
  title: string;
  rows: Record<string, number>;
  accentMap?: Record<string, string>;
}) {
  const entries = Object.entries(rows);
  const total = entries.reduce((acc, [, v]) => acc + v, 0);
  return (
    <div className="border border-[#2A2A2A] bg-[#0A0A0A] p-3">
      <div className="flex items-baseline justify-between mb-2 pb-2 border-b border-[#2A2A2A]">
        <span className="text-[10px] tracking-widest text-[#FF6600] bb-mono">{title}</span>
        <span className="text-[10px] text-[#666666] bb-mono">total: {total.toLocaleString()}</span>
      </div>
      {entries.length === 0 ? (
        <div className="text-[10px] text-[#666666] bb-mono py-2">no rows</div>
      ) : (
        entries.map(([k, v]) => (
          <StatusCount key={k} label={k} value={v} accent={accentMap?.[k] ?? "#CCCCCC"} />
        ))
      )}
    </div>
  );
}

function ThroughputStat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="border border-[#2A2A2A] bg-[#0A0A0A] p-3">
      <div className="text-[10px] tracking-widest text-[#888888] bb-mono">{label}</div>
      <div className="text-2xl bb-mono text-[#FF6600] mt-1">{value}</div>
      {sub && <div className="text-[10px] text-[#666666] bb-mono mt-0.5">{sub}</div>}
    </div>
  );
}

function ErrorsTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ errorMessage: string; count: number }>;
}) {
  return (
    <div className="border border-[#2A2A2A] bg-[#0A0A0A]">
      <div className="text-[10px] tracking-widest text-[#FF6600] bb-mono px-3 py-2 border-b border-[#2A2A2A]">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-[10px] text-[#666666] bb-mono px-3 py-3">no errors recorded</div>
      ) : (
        <table className="w-full text-[11px] bb-mono">
          <thead>
            <tr className="text-[10px] tracking-widest text-[#888888] border-b border-[#2A2A2A]">
              <th className="text-left px-3 py-2 font-normal">errorMessage</th>
              <th className="text-right px-3 py-2 font-normal w-20">count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[#1A1A1A] last:border-0">
                <td className="px-3 py-2 text-[#CCCCCC] truncate max-w-[480px]" title={r.errorMessage}>
                  {r.errorMessage}
                </td>
                <td className="px-3 py-2 text-right text-[#FF6600]">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PollerCard({ snap }: { snap: IntakeHealthSnapshot }) {
  const c = POLLER_COLOUR[snap.poller.status];
  return (
    <div className={`border ${c.border} ${c.bg} p-4`}>
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] tracking-widest text-[#888888] bb-mono">POLLER STATUS</div>
          <div className={`text-3xl bb-mono mt-1 ${c.text} tracking-[0.3em]`}>{c.label}</div>
        </div>
        <div className="text-right bb-mono">
          <div className="text-[10px] tracking-widest text-[#888888]">LAST RUN</div>
          <div className="text-sm text-[#CCCCCC] mt-1">{formatAge(snap.poller.ageSeconds)}</div>
          <div className="text-[10px] text-[#666666] mt-0.5">
            {snap.poller.lastRunAt ?? "no SchedulerLog rows yet"}
          </div>
        </div>
      </div>
      {snap.poller.lastJobError && (
        <div className="mt-3 border-t border-[#2A2A2A] pt-3">
          <div className="text-[10px] tracking-widest text-[#FF3333] bb-mono">LAST JOB ERROR</div>
          <div className="text-[11px] text-[#CCCCCC] bb-mono mt-1 break-all">{snap.poller.lastJobError}</div>
        </div>
      )}
    </div>
  );
}

const INTAKE_DOC_ACCENTS: Record<string, string> = {
  ERROR: "#FF3333",
  DEAD_LETTER: "#FF3333",
  OCR_REQUIRED: "#FF9900",
  REVIEW_REQUIRED: "#FF9900",
  NEW: "#FF9900",
  PARSED: "#1F8F3A",
  POSTED: "#1F8F3A",
  AUTO_MATCHED: "#1F8F3A",
};

const INGESTION_EVENT_ACCENTS: Record<string, string> = {
  NEEDS_TRIAGE: "#FF9900",
  NEEDS_REVIEW: "#FF9900",
  ACTIONED: "#1F8F3A",
  CLASSIFIED: "#CCCCCC",
  DISMISSED: "#666666",
};

const REVIEW_QUEUE_ACCENTS: Record<string, string> = {
  UNRESOLVED_SUPPLIER: "#FF9900",
  UNRESOLVED_CUSTOMER: "#FF9900",
  UNRESOLVED_PRODUCT: "#FF9900",
  UNRESOLVED_SITE: "#FF9900",
  MEDIA_PENDING: "#888888",
  UOM_MISMATCH: "#FF9900",
};

export default async function IntakeHealthPage() {
  let snap: IntakeHealthSnapshot | null = null;
  let fetchError: string | null = null;
  try {
    snap = await getIntakeHealthSnapshot();
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <meta httpEquiv="refresh" content="60" />
      <div className="p-4 space-y-4 bg-[#0D0D0D] min-h-screen">
        <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
          <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
            INTAKE HEALTH
          </h1>
          <div className="text-[10px] tracking-widest text-[#666666] bb-mono">
            as of {snap?.asOf ?? new Date().toISOString()} · auto-refresh 60s
          </div>
        </div>

        {fetchError && (
          <div className="border border-[#FF3333] bg-[#2A0A0A] text-[#FF3333] bb-mono text-[11px] p-3">
            ERROR: {fetchError}
          </div>
        )}

        {snap && (
          <>
            <PollerCard snap={snap} />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <QueueCard
                title="INTAKE DOCUMENTS"
                rows={snap.queue.intakeDocuments}
                accentMap={INTAKE_DOC_ACCENTS}
              />
              <QueueCard
                title="INGESTION EVENTS"
                rows={snap.queue.ingestionEvents}
                accentMap={INGESTION_EVENT_ACCENTS}
              />
              <QueueCard
                title="REVIEW QUEUE"
                rows={snap.queue.reviewQueueItems}
                accentMap={REVIEW_QUEUE_ACCENTS}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <ThroughputStat
                label="BILLS POSTED · 24H"
                value={snap.throughput.billsPostedLast24h}
              />
              <ThroughputStat
                label="BILLS POSTED · 7D"
                value={snap.throughput.billsPostedLast7d}
              />
              <ThroughputStat
                label="INGESTION · 24H"
                value={snap.throughput.ingestionLast24h}
                sub={`${snap.throughput.intakeDocsLast24h} intake docs`}
              />
              <ThroughputStat
                label="ERROR RATE · 24H"
                value={`${Math.round(snap.throughput.errorRate24h * 100)}%`}
                sub={
                  snap.throughput.intakeDocsLast24h < 5
                    ? "low volume — not computed"
                    : `over ${snap.throughput.intakeDocsLast24h} docs`
                }
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ErrorsTable
                title="TOP INTAKE-DOCUMENT ERRORS"
                rows={snap.failures.intakeDocumentTopErrors}
              />
              <ErrorsTable
                title="TOP INGESTION-EVENT ERRORS"
                rows={snap.failures.ingestionEventTopErrors}
              />
            </div>

            <div className="border border-[#2A2A2A] bg-[#0A0A0A] p-3">
              <div className="text-[10px] tracking-widest text-[#FF6600] bb-mono mb-2 pb-2 border-b border-[#2A2A2A]">
                OLDEST UNPROCESSED
              </div>
              {snap.queue.oldestUnprocessed ? (
                <div className="text-[11px] bb-mono space-y-1">
                  <div className="flex justify-between">
                    <span className="text-[#888888]">intakeDocumentId</span>
                    <Link
                      href={`/bills?intakeDocumentId=${snap.queue.oldestUnprocessed.intakeDocumentId}`}
                      className="text-[#FF6600] hover:underline"
                    >
                      {snap.queue.oldestUnprocessed.intakeDocumentId}
                    </Link>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#888888]">status</span>
                    <span className="text-[#CCCCCC]">{snap.queue.oldestUnprocessed.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#888888]">age</span>
                    <span className="text-[#FF9900]">{snap.queue.oldestUnprocessed.ageHours}h</span>
                  </div>
                  {snap.queue.oldestUnprocessed.errorMessage && (
                    <div className="pt-1 border-t border-[#1A1A1A]">
                      <div className="text-[#888888]">errorMessage</div>
                      <div className="text-[#CCCCCC] mt-1 break-all">
                        {snap.queue.oldestUnprocessed.errorMessage}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[10px] text-[#666666] bb-mono">queue is clean</div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
