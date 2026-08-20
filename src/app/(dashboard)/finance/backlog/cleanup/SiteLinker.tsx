"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  cfSite: string;
  lineCount: number;
  invoiceCount: number;
  topCustomer: string | null;
  linkedSiteId: string | null;
  linkedSiteName: string | null;
};

type OsSite = {
  id: string;
  siteName: string;
  siteCode: string | null;
  postcode: string | null;
  city: string | null;
};

type Filter = "all" | "unlinked" | "linked";

type Group = { label: string; memberIds: string[] };

export function SiteLinker() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [showGroups, setShowGroups] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("unlinked");
  const [q, setQ] = useState("");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function refresh() {
    const url = showGroups
      ? "/api/finance/backlog/cleanup/sites?groups=1"
      : "/api/finance/backlog/cleanup/sites";
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
      .filter((r) => (filter === "all" ? true : filter === "linked" ? !!r.linkedSiteId : !r.linkedSiteId))
      .filter((r) =>
        q.trim() ? r.cfSite.toLowerCase().includes(q.trim().toLowerCase()) : true
      );
  }, [rows, filter, q]);

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.cfSite));
  function toggleAll() {
    const ns = new Set(selected);
    if (allSelected) filtered.forEach((r) => ns.delete(r.cfSite));
    else filtered.forEach((r) => ns.add(r.cfSite));
    setSelected(ns);
  }
  function toggleOne(id: string) {
    const ns = new Set(selected);
    ns.has(id) ? ns.delete(id) : ns.add(id);
    setSelected(ns);
  }

  async function unlink(cfSite: string) {
    if (!confirm("Remove this link?")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/finance/backlog/cleanup/site-link/${encodeURIComponent(cfSite)}`,
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

  async function commitLink(site: OsSite) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/finance/backlog/cleanup/site-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cfSites: [...selected], siteId: site.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Link failed");
      setPicker(false);
      setSelected(new Set());
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Link failed");
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return <div className="text-[11px] text-[#666666] p-4">Loading sites…</div>;

  function selectGroup(g: Group) {
    setSelected(new Set(g.memberIds));
  }

  return (
    <div className="space-y-3">
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
          placeholder="Search CF.Site text…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 max-w-md bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-2"
        />
        <div className="text-[10px] text-[#888888]">
          {filtered.length} shown · {selected.size} selected
        </div>
        <button
          onClick={() => setPicker(true)}
          disabled={selected.size === 0 || busy}
          className="ml-auto bg-[#FF6600] text-black text-[10px] uppercase tracking-widest font-bold px-3 py-2 disabled:opacity-30 hover:bg-[#FF9900]"
        >
          Map {selected.size || ""} → OS Site
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
                  {g.memberIds.slice(0, 5).join(" · ")}
                  {g.memberIds.length > 5 ? ` · +${g.memberIds.length - 5} more` : ""}
                </div>
              </button>
            ))}
          </div>
          <div className="text-[10px] text-[#666666] mt-2">
            Click a group to select all variants, then map them to one OS Site.
          </div>
        </div>
      )}
      {showGroups && groups && groups.length === 0 && (
        <div className="border border-[#333333] bg-[#1A1A1A] p-3 text-[10px] text-[#888888]">
          No spelling-variant groups detected among unmapped sites.
        </div>
      )}

      {err && (
        <div className="bg-[#3A0000] border border-[#FF3333] text-[11px] text-[#FF6666] px-3 py-2">
          {err}
        </div>
      )}

      <div className="border border-[#333333] bg-[#1A1A1A] overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-3 py-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th className="text-left  px-3 py-2">CF.Site (Zoho text)</th>
              <th className="text-left  px-3 py-2 w-48">Linked OS Site</th>
              <th className="text-right px-3 py-2 w-16">Inv #</th>
              <th className="text-right px-3 py-2 w-16">Lines</th>
              <th className="text-left  px-3 py-2 w-56">Top Customer</th>
              <th className="text-right px-3 py-2 w-16">·</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-[11px] text-[#666666] py-6">
                  — empty —
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const sel = selected.has(r.cfSite);
              return (
                <tr
                  key={r.cfSite}
                  className={`border-b border-[#222222] hover:bg-[#222222] ${
                    sel ? "bg-[#FF66001A]" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={sel} onChange={() => toggleOne(r.cfSite)} />
                  </td>
                  <td className="px-3 py-2 text-xs text-[#E0E0E0]">{r.cfSite}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.linkedSiteId ? (
                      <a
                        href={`/sites/${r.linkedSiteId}`}
                        className="text-[#00CC66] hover:underline"
                      >
                        ✓ {r.linkedSiteName}
                      </a>
                    ) : (
                      <span className="text-[#FF9900]">unlinked</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums">{r.invoiceCount}</td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums">{r.lineCount}</td>
                  <td className="px-3 py-2 text-xs text-[#888888]">{r.topCustomer ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {r.linkedSiteId && (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setSelected(new Set([r.cfSite]));
                            setPicker(true);
                          }}
                          className="text-[10px] text-[#3399FF] hover:underline"
                          title="Pick a different OS Site for this CF.Site"
                        >
                          re-link
                        </button>
                        <button
                          onClick={() => unlink(r.cfSite)}
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

      {picker && (
        <SitePickerModal
          selectedCount={selected.size}
          selectedNames={[...selected]}
          onPick={commitLink}
          onClose={() => setPicker(false)}
          busy={busy}
        />
      )}
    </div>
  );
}

function SitePickerModal({
  selectedCount,
  selectedNames,
  onPick,
  onClose,
  busy,
}: {
  selectedCount: number;
  selectedNames: string[];
  onPick: (s: OsSite) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<OsSite[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

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
        `/api/finance/backlog/cleanup/sites?search=${encodeURIComponent(term)}`
      );
      const d = await res.json();
      setMatches(d.matches ?? []);
    } finally {
      setSearching(false);
    }
  }

  async function createOsSite() {
    setCreating(true);
    setCreateErr(null);
    try {
      const res = await fetch("/api/finance/backlog/cleanup/create-os-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteName: q.trim(), aliases: selectedNames }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Create failed");
      onPick(d.site);
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
            MAP {selectedCount} CF.SITE → OS SITE
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
            placeholder="Search OS sites by name, code, postcode, or alias…"
            className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-2"
            autoFocus
          />
          {searching && <div className="text-[10px] text-[#666666]">searching…</div>}
          <div className="border border-[#333333] bg-[#0A0A0A] max-h-72 overflow-y-auto">
            {matches.length === 0 && !searching && (
              <div className="text-[10px] text-[#666666] p-3">— no matches —</div>
            )}
            {matches.map((s) => (
              <button
                key={s.id}
                disabled={busy}
                onClick={() => onPick(s)}
                className="w-full text-left px-3 py-2 border-b border-[#1F1F1F] hover:bg-[#222222] disabled:opacity-30"
              >
                <div className="text-xs text-[#E0E0E0]">{s.siteName}</div>
                <div className="text-[10px] text-[#666666]">
                  {s.siteCode ? `${s.siteCode} · ` : ""}
                  {[s.city, s.postcode].filter(Boolean).join(" · ")}
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
              No match? Create a new OS Site
            </div>
            <button
              onClick={createOsSite}
              disabled={!q.trim() || busy || creating}
              className="w-full bg-[#00CC66] text-black text-[10px] uppercase tracking-widest font-bold px-3 py-2 disabled:opacity-30 hover:bg-[#33DD88]"
            >
              {creating ? "Creating…" : `+ Create OS Site "${q.trim()}" with ${selectedCount} alias${selectedCount !== 1 ? "es" : ""}`}
            </button>
            <div className="text-[10px] text-[#666666] mt-1">
              All {selectedCount} selected CF.Site value{selectedCount !== 1 ? "s" : ""} will be saved
              as aliases on the new site, then linked.
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
