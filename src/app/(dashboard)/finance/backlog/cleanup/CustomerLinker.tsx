"use client";

import { useEffect, useMemo, useState } from "react";
import { fmt } from "./InsightTiles";

type Row = {
  zohoCustomerId: string;
  zohoCustomerName: string | null;
  invoiceCount: number;
  totalRevenue: number;
  outstandingBalance: number;
  oldestDue: string | null;
  linkedCustomerId: string | null;
  linkedCustomerName: string | null;
};

type OsCustomer = {
  id: string;
  name: string;
  legalName: string | null;
  companyNumber: string | null;
};

type Filter = "all" | "unlinked" | "linked";

type Group = { label: string; memberIds: string[] };
type PickerMode = null | "link" | "cluster";

export function CustomerLinker() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [showGroups, setShowGroups] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("unlinked");
  const [q, setQ] = useState("");
  const [picker, setPicker] = useState<PickerMode>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function refresh() {
    const url = showGroups
      ? "/api/finance/backlog/cleanup/customers?groups=1"
      : "/api/finance/backlog/cleanup/customers";
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        setRows(d.rows);
        setGroups(d.groups ?? null);
      });
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGroups]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows
      .filter((r) => (filter === "all" ? true : filter === "linked" ? !!r.linkedCustomerId : !r.linkedCustomerId))
      .filter((r) =>
        q.trim()
          ? (r.zohoCustomerName || "").toLowerCase().includes(q.trim().toLowerCase())
          : true
      );
  }, [rows, filter, q]);

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.zohoCustomerId));
  function toggleAll() {
    const ns = new Set(selected);
    if (allSelected) {
      filtered.forEach((r) => ns.delete(r.zohoCustomerId));
    } else {
      filtered.forEach((r) => ns.add(r.zohoCustomerId));
    }
    setSelected(ns);
  }
  function toggleOne(id: string) {
    const ns = new Set(selected);
    ns.has(id) ? ns.delete(id) : ns.add(id);
    setSelected(ns);
  }

  async function unlink(zohoCustomerId: string) {
    if (!confirm("Remove this link?")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/finance/backlog/cleanup/customer-link/${encodeURIComponent(zohoCustomerId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error((await res.json()).error || "Unlink failed");
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unlink failed");
    } finally {
      setBusy(false);
    }
  }

  async function commitLink(customer: OsCustomer) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/finance/backlog/cleanup/customer-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zohoCustomerIds: [...selected], customerId: customer.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Link failed");
      setPicker(null);
      setSelected(new Set());
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Link failed");
    } finally {
      setBusy(false);
    }
  }

  async function commitCluster(parentCustomerId: string | null, newParentName: string | null) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/finance/backlog/cleanup/cluster-customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zohoCustomerIds: [...selected],
          parentCustomerId,
          newParentName,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Cluster failed");
      setPicker(null);
      setSelected(new Set());
      refresh();
      // Optional: surface a confirmation
      alert(
        `Created ${d.createdChildren?.length ?? 0} subsidiaries under "${d.parent?.name ?? ""}".${
          d.skipped ? ` Skipped ${d.skipped} (already linked).` : ""
        }`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cluster failed");
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return <div className="text-[11px] text-[#666666] p-4">Loading customers…</div>;

  function selectGroup(g: Group) {
    setSelected(new Set(g.memberIds));
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {(["unlinked", "linked", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-[10px] uppercase tracking-widest border ${
                filter === f
                  ? "border-[#FF6600] text-[#FF6600] font-bold"
                  : "border-[#333333] text-[#888888]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowGroups(!showGroups)}
          className={`px-3 py-1.5 text-[10px] uppercase tracking-widest border ${
            showGroups
              ? "border-[#00CC66] text-[#00CC66] font-bold"
              : "border-[#333333] text-[#888888]"
          }`}
        >
          {showGroups ? "✓ Suggested groups" : "Suggest groups"}
        </button>
        <input
          type="text"
          placeholder="Search Zoho customer name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 max-w-md bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-2"
        />
        <div className="text-[10px] text-[#888888]">
          {filtered.length} shown · {selected.size} selected
        </div>
        <button
          onClick={() => setPicker("link")}
          disabled={selected.size === 0 || busy}
          className="ml-auto bg-[#FF6600] text-black text-[10px] uppercase tracking-widest font-bold px-3 py-2 disabled:opacity-30 hover:bg-[#FF9900]"
          title="All selected Zoho customers point at one OS Customer (consolidation)"
        >
          Map {selected.size || ""} → 1 OS Customer
        </button>
        <button
          onClick={() => setPicker("cluster")}
          disabled={selected.size < 2 || busy}
          className="bg-[#3399FF] text-black text-[10px] uppercase tracking-widest font-bold px-3 py-2 disabled:opacity-30 hover:bg-[#66BBFF]"
          title="Create one OS Customer per Zoho selection, all under a single parent (preserves legal-entity structure)"
        >
          Cluster {selected.size > 1 ? selected.size : ""} under parent
        </button>
      </div>

      {showGroups && groups && groups.length > 0 && (
        <div className="border border-[#00CC66] bg-[#0A1F0A] p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#00CC66] font-bold mb-2">
            {groups.length} suggested group{groups.length !== 1 ? "s" : ""} ·{" "}
            {groups.reduce((s, g) => s + g.memberIds.length, 0)} variants total
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {groups.map((g, idx) => (
              <button
                key={idx}
                onClick={() => selectGroup(g)}
                className="block w-full text-left px-2 py-1.5 bg-[#0A0A0A] border border-[#333333] hover:border-[#00CC66]"
              >
                <div className="text-xs text-[#E0E0E0]">
                  {g.label}{" "}
                  <span className="text-[10px] text-[#888888]">({g.memberIds.length} variants)</span>
                </div>
                <div className="text-[10px] text-[#888888] mt-0.5">
                  {g.memberIds
                    .slice(0, 5)
                    .map((id) => rows?.find((r) => r.zohoCustomerId === id)?.zohoCustomerName ?? id)
                    .join(" · ")}
                  {g.memberIds.length > 5 ? ` · +${g.memberIds.length - 5} more` : ""}
                </div>
              </button>
            ))}
          </div>
          <div className="text-[10px] text-[#666666] mt-2">
            Click a group to select all variants, then map them to one OS Customer.
          </div>
        </div>
      )}
      {showGroups && groups && groups.length === 0 && (
        <div className="border border-[#333333] bg-[#1A1A1A] p-3 text-[10px] text-[#888888]">
          No spelling-variant groups detected among unmapped customers.
        </div>
      )}

      {err && (
        <div className="bg-[#3A0000] border border-[#FF3333] text-[11px] text-[#FF6666] px-3 py-2">
          {err}
        </div>
      )}

      {/* Table */}
      <div className="border border-[#333333] bg-[#1A1A1A] overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-3 py-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th className="text-left  px-3 py-2">Zoho Customer</th>
              <th className="text-left  px-3 py-2 w-48">Linked OS Customer</th>
              <th className="text-right px-3 py-2 w-16">Inv #</th>
              <th className="text-right px-3 py-2 w-28">Outstanding</th>
              <th className="text-right px-3 py-2 w-28">Lifetime £</th>
              <th className="text-right px-3 py-2 w-24">Oldest Due</th>
              <th className="text-right px-3 py-2 w-16">·</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-[11px] text-[#666666] py-6">
                  — empty —
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const sel = selected.has(r.zohoCustomerId);
              return (
                <tr
                  key={r.zohoCustomerId}
                  className={`border-b border-[#222222] hover:bg-[#222222] ${
                    sel ? "bg-[#FF66001A]" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={() => toggleOne(r.zohoCustomerId)}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-[#E0E0E0]">
                    {r.zohoCustomerName ?? "—"}
                    <div className="text-[9px] text-[#666666]">{r.zohoCustomerId}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.linkedCustomerId ? (
                      <a
                        href={`/customers/${r.linkedCustomerId}`}
                        className="text-[#00CC66] hover:underline"
                      >
                        ✓ {r.linkedCustomerName}
                      </a>
                    ) : (
                      <span className="text-[#FF9900]">unlinked</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                    {r.invoiceCount}
                  </td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums">
                    {r.outstandingBalance > 0 ? (
                      <span className="text-[#FF6600]">£{fmt(r.outstandingBalance)}</span>
                    ) : (
                      <span className="text-[#666666]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums text-[#888888]">
                    £{fmt(r.totalRevenue)}
                  </td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums text-[#888888]">
                    {r.oldestDue ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.linkedCustomerId && (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setSelected(new Set([r.zohoCustomerId]));
                            setPicker("link");
                          }}
                          className="text-[10px] text-[#3399FF] hover:underline"
                          title="Pick a different OS Customer for this Zoho row"
                        >
                          re-link
                        </button>
                        <button
                          onClick={() => unlink(r.zohoCustomerId)}
                          className="text-[10px] text-[#FF6666] hover:underline"
                        >
                          unlink
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {picker === "link" && (
        <CustomerPickerModal
          selectedCount={selected.size}
          selectedNames={[...selected]
            .map((id) => rows.find((r) => r.zohoCustomerId === id)?.zohoCustomerName)
            .filter(Boolean) as string[]}
          onPick={commitLink}
          onClose={() => setPicker(null)}
          busy={busy}
        />
      )}

      {picker === "cluster" && (
        <ClusterPickerModal
          selectedNames={
            [...selected]
              .map((id) => rows.find((r) => r.zohoCustomerId === id)?.zohoCustomerName)
              .filter(Boolean) as string[]
          }
          onPick={(parentCustomerId) => commitCluster(parentCustomerId, null)}
          onCreate={(newParentName) => commitCluster(null, newParentName)}
          onClose={() => setPicker(null)}
          busy={busy}
        />
      )}
    </div>
  );
}

function ClusterPickerModal({
  selectedNames,
  onPick,
  onCreate,
  onClose,
  busy,
}: {
  selectedNames: string[];
  onPick: (parentCustomerId: string) => void;
  onCreate: (newParentName: string) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<OsCustomer[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    // Suggest the longest token from names as the default parent name
    const guess = pickGroupName(selectedNames);
    setQ(guess);
    if (guess) doSearch(guess);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSearch(term: string) {
    if (!term.trim()) {
      setMatches([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/finance/backlog/cleanup/customers?search=${encodeURIComponent(term)}`
      );
      const d = await res.json();
      setMatches(d.matches ?? []);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6"
      onClick={() => !busy && onClose()}
    >
      <div
        className="bg-[#1A1A1A] border border-[#3399FF] w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[#333333] px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-[#3399FF] font-bold">
            CLUSTER {selectedNames.length} ZOHO CUSTOMERS UNDER ONE PARENT
          </div>
          <div className="text-[10px] text-[#888888] mt-1">
            Each Zoho customer becomes its own OS Customer (LE preserved). All share the parent
            below. Reports can roll up by parent.
          </div>
          <div className="text-[10px] text-[#666666] mt-2">
            <span className="uppercase tracking-widest text-[#888888] font-bold">CHILDREN: </span>
            {selectedNames.slice(0, 5).join(" · ")}
            {selectedNames.length > 5 ? ` · +${selectedNames.length - 5} more` : ""}
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-[#888888] mb-1">
            Find or name the parent
          </div>
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              doSearch(e.target.value);
            }}
            placeholder="Search OS customers (existing parent) or type a new parent name…"
            className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-2"
            autoFocus
          />
          {searching && <div className="text-[10px] text-[#666666]">searching…</div>}
          <div className="border border-[#333333] bg-[#0A0A0A] max-h-56 overflow-y-auto">
            {matches.length === 0 && !searching && (
              <div className="text-[10px] text-[#666666] p-3">
                — no existing OS customer matches —
              </div>
            )}
            {matches.map((c) => (
              <button
                key={c.id}
                disabled={busy}
                onClick={() => onPick(c.id)}
                className="w-full text-left px-3 py-2 border-b border-[#1F1F1F] hover:bg-[#222222] disabled:opacity-30"
              >
                <div className="text-xs text-[#E0E0E0]">{c.name}</div>
                <div className="text-[10px] text-[#666666]">
                  Use as parent · {c.legalName ? `${c.legalName} · ` : ""}
                  {c.companyNumber ? `Co# ${c.companyNumber}` : ""}
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-[#333333] pt-3">
            <div className="text-[10px] uppercase tracking-widest text-[#888888] mb-2">
              No existing parent? Create a new group parent
            </div>
            <button
              onClick={() => onCreate(q.trim())}
              disabled={!q.trim() || busy}
              className="w-full bg-[#3399FF] text-black text-[10px] uppercase tracking-widest font-bold px-3 py-2 disabled:opacity-30 hover:bg-[#66BBFF]"
            >
              + Create parent &quot;{q.trim()}&quot; and {selectedNames.length} subsidiaries
            </button>
            <div className="text-[10px] text-[#666666] mt-1">
              The new parent is non-billing (entityType = GROUP_PARENT). Each child is a billing
              subsidiary linked to its corresponding Zoho customer.
            </div>
          </div>
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

/** Heuristic: pick the longest common prefix-ish word as a candidate parent name. */
function pickGroupName(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  // Return the shortest variant — usually the cleanest "core" name
  // (e.g. "Vabel Construction Ltd" out of {"Vabel Construction 6 Ltd", ...}).
  let shortest = names[0];
  for (const n of names) if (n.length < shortest.length) shortest = n;
  // Strip trailing digits/words like "6 Ltd" → "Construction Ltd"
  const stripped = shortest.replace(/\s*\b\d+\b\s*/g, " ").replace(/\s+/g, " ").trim();
  return stripped || shortest;
}

function CustomerPickerModal({
  selectedCount,
  selectedNames,
  onPick,
  onClose,
  busy,
}: {
  selectedCount: number;
  selectedNames: string[];
  onPick: (c: OsCustomer) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<OsCustomer[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Auto-suggest based on the first selected name on open
  useEffect(() => {
    if (selectedNames[0]) {
      setQ(selectedNames[0]);
      doSearch(selectedNames[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSearch(term: string) {
    if (!term.trim()) {
      setMatches([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/finance/backlog/cleanup/customers?search=${encodeURIComponent(term)}`
      );
      const d = await res.json();
      setMatches(d.matches ?? []);
    } finally {
      setSearching(false);
    }
  }

  async function createOsCustomer() {
    setCreating(true);
    setCreateErr(null);
    try {
      const res = await fetch("/api/finance/backlog/cleanup/create-os-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: q.trim(), aliases: selectedNames }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Create failed");
      onPick(d.customer);
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6"
      onClick={() => !busy && onClose()}
    >
      <div
        className="bg-[#1A1A1A] border border-[#333333] w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[#333333] px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-[#FF6600] font-bold">
            MAP {selectedCount} ZOHO CUSTOMER{selectedCount !== 1 ? "S" : ""} → OS CUSTOMER
          </div>
          <div className="text-[10px] text-[#888888] mt-1">
            {selectedNames.slice(0, 4).join(" · ")}
            {selectedNames.length > 4 ? ` · +${selectedNames.length - 4} more` : ""}
          </div>
        </div>

        <div className="p-4 space-y-3">
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              doSearch(e.target.value);
            }}
            placeholder="Search OS customers by name, legal name, or alias…"
            className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-2"
            autoFocus
          />
          {searching && <div className="text-[10px] text-[#666666]">searching…</div>}
          <div className="border border-[#333333] bg-[#0A0A0A] max-h-72 overflow-y-auto">
            {matches.length === 0 && !searching && (
              <div className="text-[10px] text-[#666666] p-3">
                — no matches — type more or refine search
              </div>
            )}
            {matches.map((c) => (
              <button
                key={c.id}
                disabled={busy}
                onClick={() => onPick(c)}
                className="w-full text-left px-3 py-2 border-b border-[#1F1F1F] hover:bg-[#222222] disabled:opacity-30"
              >
                <div className="text-xs text-[#E0E0E0]">{c.name}</div>
                <div className="text-[10px] text-[#666666]">
                  {c.legalName ? `${c.legalName} · ` : ""}
                  {c.companyNumber ? `Co# ${c.companyNumber}` : ""}
                </div>
              </button>
            ))}
          </div>

          {createErr && (
            <div className="bg-[#3A0000] border border-[#FF3333] text-[11px] text-[#FF6666] px-3 py-2">
              {createErr}
            </div>
          )}

          <div className="border-t border-[#333333] pt-3">
            <div className="text-[10px] uppercase tracking-widest text-[#888888] mb-2">
              No match? Create a new OS Customer
            </div>
            <button
              onClick={createOsCustomer}
              disabled={!q.trim() || busy || creating}
              className="w-full bg-[#00CC66] text-black text-[10px] uppercase tracking-widest font-bold px-3 py-2 disabled:opacity-30 hover:bg-[#33DD88]"
            >
              {creating
                ? "Creating…"
                : `+ Create OS Customer "${q.trim()}" with ${selectedCount} alias${selectedCount !== 1 ? "es" : ""}`}
            </button>
            <div className="text-[10px] text-[#666666] mt-1">
              All {selectedCount} selected Zoho customer name{selectedCount !== 1 ? "s" : ""} will be saved
              as aliases on the new customer, then linked.
            </div>
          </div>
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
