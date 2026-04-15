"use client";

import { useEffect, useState } from "react";

interface CashPosition {
  receivables: number;
  receivablesCount: number;
  payables: number;
  payablesCount: number;
  disputed: number;
  disputedCount: number;
  available: number;
}

interface TaskRow {
  id: string;
  taskType: string;
  priority: string;
  status: string;
  dueAt: string | null;
  generatedReason: string | null;
  ticketId: string;
  ticket?: {
    ticketNo: number;
    title: string;
    payingCustomer?: { name: string };
    site?: { siteName: string } | null;
  };
}

interface CommandCentreData {
  generatedAt: string;
  durationMs: number;
  cashPosition: CashPosition;
  criticalTasks: TaskRow[];
  todayTasks: TaskRow[];
  inTransit: Array<Record<string, unknown>>;
  uninvoicedDeliveries: Array<Record<string, unknown>>;
  disputedBills: Array<Record<string, unknown>>;
  surplusStock: Array<Record<string, unknown>>;
  systemHealth: {
    lastSchedulerRuns: Record<string, { status: string; startedAt: string; finishedAt: string | null }>;
    recentLogs: Array<{ job: string; status: string; startedAt: string; finishedAt: string | null; error: string | null }>;
    openTasksByType: Record<string, number>;
  };
}

const TASK_COLORS: Record<string, string> = {
  SUPPLIER_DISPUTE: "#FF3333",
  BANK_DETAIL_CHANGE_ALERT: "#FF3333",
  PAYMENT_OVERDUE: "#FF3333",
  INVOICE_REQUIRED: "#FF9900",
  REDELIVERY_REQUIRED: "#FF6600",
  OVERDUE_DELIVERY: "#FF6600",
  ADDRESS_CONFLICT: "#B366FF",
  ADDRESS_CHANGE_PENDING: "#B366FF",
  MISCOMM_DETECTED: "#B366FF",
  CHASE_PAYMENT: "#33AAFF",
  CHASE_CREDIT_NOTE: "#33AAFF",
  SURPLUS_ACTION_REQUIRED: "#FFCC33",
  SURPLUS_MATCH_AVAILABLE: "#33CC66",
  RETURN_TO_SUPPLIER: "#FFCC33",
  STORE_BANK_DETAILS: "#B366FF",
};

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
}

export function CommandCentreView() {
  const [data, setData] = useState<CommandCentreData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await fetch("/api/command-centre", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as CommandCentreData;
      setData(j);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load command centre");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (loading) return <div className="bb-mono text-sm text-[#888]">Loading command centre…</div>;
  if (error) return <div className="bb-mono text-sm text-[#FF3333]">Error: {error}</div>;
  if (!data) return null;

  const cp = data.cashPosition;

  return (
    <div className="space-y-6">
      {/* Cash strip */}
      <section className="grid grid-cols-4 gap-2 border border-[#333] bg-[#0b0b0b] p-3">
        <Money label="Receivables" value={cp.receivables} count={cp.receivablesCount} color="#33CC66" />
        <Money label="Payables"    value={cp.payables}    count={cp.payablesCount}    color="#FFCC33" />
        <Money label="Disputed"    value={cp.disputed}    count={cp.disputedCount}    color="#FF3333" />
        <Money label="Available"   value={cp.available}                                color={cp.available >= 0 ? "#33CC66" : "#FF3333"} />
      </section>

      {/* Critical alerts */}
      {data.criticalTasks.length > 0 && (
        <Section title="CRITICAL ALERTS" color="#FF3333">
          <TaskList tasks={data.criticalTasks} />
        </Section>
      )}

      {/* Today's actions */}
      <Section title={`TODAY'S ACTIONS (${data.todayTasks.length})`} color="#FF6600">
        {data.todayTasks.length === 0 ? (
          <p className="bb-mono text-xs text-[#666]">No tasks due today.</p>
        ) : (
          <TaskList tasks={data.todayTasks} />
        )}
      </Section>

      {/* In transit */}
      <Section title={`IN TRANSIT (${data.inTransit.length})`} color="#FF9900">
        {data.inTransit.length === 0 ? (
          <p className="bb-mono text-xs text-[#666]">No POs with failed deliveries.</p>
        ) : (
          <ul className="bb-mono text-xs space-y-1">
            {data.inTransit.map((po, i) => {
              const p = po as any;
              const ev = p.ticket?.logisticsEvents?.[0];
              return (
                <li key={p.id ?? i} className="border-b border-[#222] pb-1">
                  <span className="text-[#FF6600]">{ev?.stopStatus ?? "—"}</span>{" "}
                  <span className="text-[#ccc]">{p.poNo}</span>{" "}
                  <span className="text-[#888]">{p.supplier?.name}</span>{" "}
                  <span className="text-[#888]">→ #{p.ticket?.ticketNo} {p.ticket?.site?.siteName ?? ""}</span>{" "}
                  <span className="text-[#666]">cp={ev?.cpRef ?? "—"} driver={ev?.driver ?? "—"}</span>
                  <div className="flex gap-2 mt-1">
                    <ActionBtn label="REBOOK"   onClick={() => alert("REBOOK not yet wired")} />
                    <ActionBtn label="REDIRECT" onClick={() => alert("REDIRECT not yet wired")} />
                    <ActionBtn label="ESCALATE" onClick={() => alert("ESCALATE not yet wired")} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Uninvoiced deliveries */}
      <Section title={`UNINVOICED DELIVERIES (${data.uninvoicedDeliveries.length})`} color="#FF9900">
        {data.uninvoicedDeliveries.length === 0 ? (
          <p className="bb-mono text-xs text-[#666]">Every delivery is invoiced.</p>
        ) : (
          <ul className="bb-mono text-xs space-y-1">
            {data.uninvoicedDeliveries.map((e, i) => {
              const ev = e as any;
              const lines = ev.ticket?.lines ?? [];
              const est = lines.reduce((sum: number, l: any) => {
                const u = l.actualSaleUnit ?? l.suggestedSaleUnit;
                return u ? sum + Number(l.qty) * Number(u) : sum;
              }, 0);
              return (
                <li key={ev.id ?? i} className="border-b border-[#222] pb-1">
                  <span className="text-[#ccc]">#{ev.ticket?.ticketNo}</span>{" "}
                  <span className="text-[#888]">{ev.ticket?.payingCustomer?.name}</span>{" "}
                  <span className="text-[#888]">{ev.ticket?.site?.siteName ?? ""}</span>{" "}
                  <span className="text-[#666]">delivered {new Date(ev.deliveredAt ?? ev.timestamp).toISOString().slice(0, 10)}</span>{" "}
                  <span className="text-[#33CC66]">est {fmt(est)}</span>{" "}
                  <span className="text-[#666]">{lines.length} uninvoiced line(s)</span>
                  <div className="flex gap-2 mt-1">
                    <ActionBtn label="RAISE INVOICE" onClick={() => alert("RAISE INVOICE: open invoice draft pre-filled")} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Disputed bills */}
      <Section title={`DISPUTED BILLS (${data.disputedBills.length})`} color="#FF3333">
        {data.disputedBills.length === 0 ? (
          <p className="bb-mono text-xs text-[#666]">No disputed supplier bills.</p>
        ) : (
          <ul className="bb-mono text-xs space-y-1">
            {data.disputedBills.map((b, i) => {
              const bill = b as any;
              const task = bill.tasks?.[0];
              return (
                <li key={bill.id ?? i} className="border-b border-[#222] pb-1">
                  <span className="text-[#FF3333]">DISPUTE</span>{" "}
                  <span className="text-[#ccc]">{bill.supplier?.name}</span>{" "}
                  <span className="text-[#888]">{bill.billNo}</span>{" "}
                  <span className="text-[#888]">{fmt(Number(bill.amountIncVat ?? bill.totalCost ?? 0))}</span>{" "}
                  <span className="text-[#666]">matched {new Date(bill.matchedAt ?? 0).toISOString().slice(0, 10)}</span>
                  <div className="flex gap-2 mt-1">
                    <ActionBtn
                      label="SEND DISPUTE EMAIL"
                      onClick={() => alert(task?.draftBody ? `Pre-drafted email:\n\n${task.draftBody}` : "No draft body on task")}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Surplus stock */}
      <Section title={`SURPLUS STOCK (${data.surplusStock.length})`} color="#FFCC33">
        {data.surplusStock.length === 0 ? (
          <p className="bb-mono text-xs text-[#666]">No unresolved surplus stock.</p>
        ) : (
          <ul className="bb-mono text-xs space-y-1">
            {data.surplusStock.map((s, i) => {
              const r = s as any;
              const age = Math.floor((Date.now() - new Date(r.createdAt).getTime()) / (24 * 60 * 60 * 1000));
              return (
                <li key={r.id ?? i} className="border-b border-[#222] pb-1">
                  <span className="text-[#FFCC33]">£{Number(r.excessCost).toFixed(2)}</span>{" "}
                  <span className="text-[#888]">{r.excessQty ?? "?"} units</span>{" "}
                  <span className="text-[#ccc]">{r.canonicalProduct?.name ?? r.ticketLine?.description ?? r.description}</span>{" "}
                  <span className="text-[#666]">from #{r.ticketLine?.ticket?.ticketNo ?? "?"} — {age}d</span>
                  <div className="flex gap-2 mt-1">
                    <ActionBtn label="TRANSFER"          onClick={() => alert("TRANSFER not yet wired")} />
                    <ActionBtn label="RETURN TO SUPPLIER" onClick={() => alert("RETURN not yet wired")} />
                    <ActionBtn label="WRITE OFF"         onClick={() => alert("WRITE OFF not yet wired")} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* System health */}
      <Section title="SYSTEM HEALTH" color="#888">
        <div className="bb-mono text-xs space-y-1 text-[#888]">
          <div>Last scheduler runs:</div>
          <ul className="ml-2 space-y-0.5">
            {Object.entries(data.systemHealth.lastSchedulerRuns).map(([job, info]) => (
              <li key={job}>
                <span className="text-[#ccc]">{job.padEnd(28)}</span>{" "}
                <span className={info.status === "OK" ? "text-[#33CC66]" : info.status === "FAILED" ? "text-[#FF3333]" : "text-[#FFCC33]"}>
                  {info.status}
                </span>{" "}
                <span className="text-[#666]">{new Date(info.startedAt).toISOString().replace("T", " ").slice(0, 19)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2">Open tasks by type:</div>
          <ul className="ml-2 space-y-0.5">
            {Object.entries(data.systemHealth.openTasksByType).map(([t, n]) => (
              <li key={t}>
                <span className="text-[#ccc]">{t.padEnd(32)}</span>{" "}
                <span className="text-[#FF9900]">{n}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-[#666]">
            Data generated {new Date(data.generatedAt).toISOString().replace("T", " ").slice(0, 19)} ({data.durationMs}ms)
          </div>
        </div>
      </Section>
    </div>
  );
}

function Money({ label, value, count, color }: { label: string; value: number; count?: number; color: string }) {
  return (
    <div className="bb-mono border border-[#222] p-2">
      <div className="text-[10px] tracking-widest text-[#888]">{label}</div>
      <div className="text-lg font-bold" style={{ color }}>{fmt(value)}</div>
      {count !== undefined && <div className="text-[10px] text-[#666]">{count} record(s)</div>}
    </div>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <section className="border border-[#222] bg-[#0b0b0b] p-3">
      <h2 className="bb-mono text-xs font-bold tracking-widest mb-2 pb-1 border-b border-[#222]" style={{ color }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function TaskList({ tasks }: { tasks: TaskRow[] }) {
  return (
    <ul className="bb-mono text-xs space-y-1">
      {tasks.map((t) => {
        const color = TASK_COLORS[t.taskType] ?? "#888";
        return (
          <li key={t.id} className="border-b border-[#222] pb-1">
            <span className="px-1" style={{ color, border: `1px solid ${color}` }}>{t.taskType}</span>{" "}
            <span className="text-[#888]">{t.priority}</span>{" "}
            {t.ticket && (
              <>
                <span className="text-[#ccc]">#{t.ticket.ticketNo} {t.ticket.title.slice(0, 40)}</span>{" "}
                <span className="text-[#888]">{t.ticket.payingCustomer?.name ?? ""}</span>
              </>
            )}
            <div className="text-[#888] text-[11px] mt-0.5">{(t.generatedReason ?? "").slice(0, 200)}</div>
          </li>
        );
      })}
    </ul>
  );
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="bb-mono text-[10px] border border-[#333] px-2 py-0.5 hover:bg-[#222] text-[#ccc]"
      onClick={onClick}
    >
      {label}
    </button>
  );
}
