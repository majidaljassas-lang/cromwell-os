"use client";

import { useEffect, useState } from "react";

const fmt = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Inv = {
  id: string;
  zohoCustomerId: string;
  zohoNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  total: number | null;
  balance: number | null;
  status: string | null;
  cleanupDecision: string | null;
  lineCount: number;
  attributedToCustomerId: string;
  attributedToCustomerName: string;
  isOverride: boolean;
};

type GroupMember = {
  id: string;
  name: string;
  entityType: string | null;
  isCurrent: boolean;
};

export function ZohoCustomerHistoryTab({ customerId }: { customerId: string }) {
  const [invoices, setInvoices] = useState<Inv[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[] | null>(null);
  const [moveTarget, setMoveTarget] = useState<Inv | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    fetch(`/api/customers/${customerId}/zoho-invoices`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setInvoices(d.invoices ?? []))
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  }
  useEffect(() => {
    refresh();
    fetch(`/api/customers/${customerId}/group-siblings`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setGroupMembers(d.members ?? []))
      .catch(() => setGroupMembers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function moveInvoice(invoice: Inv, toCustomerId: string | null) {
    setBusy(true);
    try {
      const res = await fetch("/api/finance/backlog/cleanup/invoice-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceIds: [invoice.id],
          customerId: toCustomerId,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Move failed");
      setMoveTarget(null);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Move failed");
    } finally {
      setBusy(false);
    }
  }

  if (err) return <div className="text-sm text-red-500 p-2">{err}</div>;
  if (invoices === null) return <div className="text-sm text-muted-foreground p-2">Loading…</div>;
  if (invoices.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-3 border rounded">
        No Zoho-mapped invoices for this customer. Map historical Zoho customers to this OS Customer
        from{" "}
        <a href="/finance/backlog/cleanup?tab=customers" className="text-orange-500 hover:underline">
          Backlog · Cleanup · Customers
        </a>
        .
      </div>
    );
  }

  const totalCount = invoices.length;
  const closedRevenue = invoices
    .filter((i) => i.status === "Closed")
    .reduce((s, i) => s + (i.total ?? 0), 0);
  const outstanding = invoices
    .filter((i) => (i.balance ?? 0) > 0)
    .reduce((s, i) => s + (i.balance ?? 0), 0);
  const distinctZohoCustomers = new Set(invoices.map((i) => i.zohoCustomerId)).size;

  // Roll-up attribution: count invoices per OS customer in the hierarchy
  const byAttribution = new Map<
    string,
    { name: string; count: number; outstanding: number }
  >();
  for (const i of invoices) {
    const e =
      byAttribution.get(i.attributedToCustomerId) || {
        name: i.attributedToCustomerName,
        count: 0,
        outstanding: 0,
      };
    e.count++;
    if ((i.balance ?? 0) > 0) e.outstanding += i.balance ?? 0;
    byAttribution.set(i.attributedToCustomerId, e);
  }
  const attributions = [...byAttribution.entries()].sort(
    (a, b) => b[1].outstanding - a[1].outstanding || b[1].count - a[1].count
  );
  const isRollup = attributions.length > 1 || attributions[0]?.[0] !== customerId;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Zoho Invoices" value={String(totalCount)} />
        <Stat label="Linked Zoho Customers" value={String(distinctZohoCustomers)} />
        <Stat label="Closed Revenue (Zoho)" value={`£${fmt(closedRevenue)}`} />
        <Stat
          label="Outstanding (Zoho)"
          value={`£${fmt(outstanding)}`}
          tone={outstanding > 0 ? "alert" : "ok"}
        />
      </div>

      {isRollup && (
        <div className="border bg-card p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Roll-up across hierarchy
          </div>
          <div className="space-y-1">
            {attributions.map(([id, e]) => (
              <div key={id} className="flex items-baseline justify-between text-xs">
                <a href={`/customers/${id}`} className="text-orange-500 hover:underline">
                  {e.name}
                </a>
                <div className="text-muted-foreground tabular-nums">
                  {e.count} inv ·{" "}
                  {e.outstanding > 0 ? (
                    <span className="text-red-500">£{fmt(e.outstanding)} owed</span>
                  ) : (
                    <span>£0 owed</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border bg-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="text-left  px-3 py-2 w-24">Date</th>
              <th className="text-left  px-3 py-2 w-24">Due</th>
              <th className="text-left  px-3 py-2 w-28">Invoice #</th>
              {isRollup && <th className="text-left px-3 py-2 w-44">Attributed to</th>}
              <th className="text-left  px-3 py-2 w-20">Status</th>
              <th className="text-right px-3 py-2 w-12">Lines</th>
              <th className="text-right px-3 py-2 w-28">Total</th>
              <th className="text-right px-3 py-2 w-28">Balance</th>
              <th className="text-left  px-3 py-2 w-32">Decision</th>
              <th className="text-right px-3 py-2 w-20">·</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-b hover:bg-muted/30">
                <td className="px-3 py-2">{i.invoiceDate ?? "—"}</td>
                <td className="px-3 py-2">{i.dueDate ?? "—"}</td>
                <td className="px-3 py-2">
                  <a
                    href={`/finance/backlog/invoices`}
                    className="text-orange-500 hover:underline"
                    title="Open in backlog (Zoho-imported)"
                  >
                    {i.zohoNumber ?? "—"}
                  </a>
                </td>
                {isRollup && (
                  <td className="px-3 py-2">
                    <a
                      href={`/customers/${i.attributedToCustomerId}`}
                      className="text-orange-500 hover:underline"
                    >
                      {i.attributedToCustomerName}
                    </a>
                    {i.isOverride && (
                      <span
                        className="ml-1 text-[9px] uppercase tracking-widest text-blue-500"
                        title="This invoice was moved here via per-invoice override"
                      >
                        ●override
                      </span>
                    )}
                  </td>
                )}
                <td className="px-3 py-2">{i.status ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{i.lineCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">£{fmt(i.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {(i.balance ?? 0) > 0 ? (
                    <span className="text-orange-500">£{fmt(i.balance)}</span>
                  ) : (
                    `£${fmt(i.balance)}`
                  )}
                </td>
                <td className="px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  {i.cleanupDecision ?? "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setMoveTarget(i)}
                    className="text-[10px] text-blue-500 hover:underline"
                    title="Move this invoice to a different OS Customer"
                  >
                    move →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {moveTarget && (
        <MoveInvoiceModal
          invoice={moveTarget}
          groupMembers={groupMembers ?? []}
          currentCustomerId={customerId}
          busy={busy}
          onPick={(toCustomerId) => moveInvoice(moveTarget, toCustomerId)}
          onClear={() => moveInvoice(moveTarget, null)}
          onClose={() => setMoveTarget(null)}
        />
      )}
    </div>
  );
}

function MoveInvoiceModal({
  invoice,
  groupMembers,
  currentCustomerId,
  busy,
  onPick,
  onClear,
  onClose,
}: {
  invoice: Inv;
  groupMembers: GroupMember[];
  currentCustomerId: string;
  busy: boolean;
  onPick: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filteredGroup = groupMembers.filter((m) => m.id !== invoice.attributedToCustomerId);
  const matchingGroup =
    search.trim().length === 0
      ? filteredGroup
      : filteredGroup.filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6"
      onClick={() => !busy && onClose()}
    >
      <div
        className="bg-[#1A1A1A] border border-blue-500 w-full max-w-xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[#333333] px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-blue-500 font-bold">
            MOVE INVOICE TO A DIFFERENT OS CUSTOMER
          </div>
          <div className="text-xs text-[#E0E0E0] mt-1">
            {invoice.zohoNumber ?? "(no number)"} · {invoice.invoiceDate ?? "—"} ·{" "}
            <span className="tabular-nums">£{fmt(invoice.total)}</span>
          </div>
          <div className="text-[10px] text-[#888888] mt-1">
            Currently attributed to:{" "}
            <span className="text-[#E0E0E0]">{invoice.attributedToCustomerName}</span>
            {invoice.isOverride && (
              <span className="ml-2 text-blue-400">(via override)</span>
            )}
          </div>
        </div>

        <div className="p-4 space-y-3">
          {filteredGroup.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#888888] mb-1">
                Group members
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter group…"
                className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5 mb-2"
              />
              <div className="border border-[#333333] bg-[#0A0A0A] max-h-64 overflow-y-auto">
                {matchingGroup.map((m) => (
                  <button
                    key={m.id}
                    disabled={busy}
                    onClick={() => onPick(m.id)}
                    className="w-full text-left px-3 py-2 border-b border-[#1F1F1F] hover:bg-[#222222] disabled:opacity-30"
                  >
                    <div className="text-xs text-[#E0E0E0]">
                      {m.name}{" "}
                      {m.id === currentCustomerId && (
                        <span className="text-[9px] text-blue-400 ml-1">(this customer)</span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#666666]">
                      {m.entityType ?? "—"}
                    </div>
                  </button>
                ))}
                {matchingGroup.length === 0 && (
                  <div className="text-[10px] text-[#666666] p-3">— no match —</div>
                )}
              </div>
            </div>
          )}

          {invoice.isOverride && (
            <div className="border-t border-[#333333] pt-3">
              <button
                onClick={onClear}
                disabled={busy}
                className="text-[10px] uppercase tracking-widest text-[#FF6666] hover:underline disabled:opacity-30"
              >
                Clear override (revert to Zoho-customer link)
              </button>
            </div>
          )}
        </div>

        <div className="border-t border-[#333333] px-4 py-2 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-[10px] uppercase tracking-widest text-[#888888] hover:text-[#E0E0E0]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "alert" | "ok";
}) {
  const accent =
    tone === "alert" ? "text-red-500" : tone === "ok" ? "text-green-500" : "text-foreground";
  return (
    <div className="border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-base font-bold tabular-nums mt-1 ${accent}`}>{value}</div>
    </div>
  );
}
