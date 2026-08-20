"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LineCustomerSwap } from "./line-customer-swap";
import { LineSiteSwap } from "./line-site-swap";
import { SourcePdfPreview } from "./source-pdf-preview";

type Allocation = {
  id: string;
  allocationType: "TICKET_LINE" | "STOCK" | "RETURNS_CANDIDATE" | "OVERHEAD" | "UNRESOLVED";
  ticketLineId: string | null;
  ticketId: string | null;
  siteId: string | null;
  customerId: string | null;
  qtyAllocated: string | number;
  costAllocated: string | number;
  reason: string | null;
  costAllocationId: string | null;
  returnId: string | null;
  stockExcessRecordId: string | null;
  absorbedAllocationId: string | null;
  resolvedSite: { id: string; siteName: string } | null;
  resolvedCustomer: { id: string; name: string } | null;
  saleAllocated: number | null;
  marginAllocated: number | null;
};

type GlAccountRef = {
  id: string;
  accountCode: string;
  accountName: string;
};

type GlBucketOption = GlAccountRef & { label: string };

type LineMatchCandidate = {
  ticketLineId: string;
  ticketId: string | null;
  ticketNo: number | null;
  ticketTitle: string | null;
  customer: { id: string; name: string } | null;
  site: { id: string; siteName: string } | null;
};

type LineMatch = {
  id: string;
  candidateType: string;
  candidateId: string;
  overallConfidence: string | number | null;
  candidate: LineMatchCandidate | null;
};

type BillLine = {
  id: string;
  description: string;
  productCode: string | null;
  qty: string | number;
  unitCost: string | number;
  lineTotal: string | number;
  allocationStatus: "MATCHED" | "PARTIAL" | "SUGGESTED" | "EXCEPTION" | "UNALLOCATED";
  vatRate: string | number | null;
  vatStatus: string | null;
  ticketId: string | null;
  ticket: { id: string; ticketNo?: string | null } | null;
  site: { id: string; siteName: string } | null;
  customer: { id: string; name: string } | null;
  customerId: string | null;
  siteId: string | null;
  glAccountId: string | null;
  glAccount: GlAccountRef | null;
  billLineAllocations: Allocation[];
  billLineMatches?: LineMatch[];
};

type Bill = {
  id: string;
  billNo: string;
  billDate: string;
  status: string;
  totalCost: string | number;
  customerRef: string | null;
  siteRef: string | null;
  supplier: { id: string; name: string };
  lines: BillLine[];
  intakeDocument: { id: string; rawText: string | null; fileRef: string | null; sourceRef: string | null } | null;
};

type TicketOption = {
  id: string;
  ticketNo: number;
  title: string;
  status: string;
  payingCustomerId: string | null;
  siteId: string | null;
};

type CustomerOption = {
  id: string;
  name: string;
  legalName?: string | null;
};

type SiteOption = {
  id: string;
  siteName: string;
  siteCode?: string | null;
};

function fmt(n: string | number | null | undefined): string {
  if (n == null) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ALLOC_COLOUR: Record<Allocation["allocationType"], string> = {
  TICKET_LINE:       "#00CC66",
  STOCK:             "#3399FF",
  RETURNS_CANDIDATE: "#FF9900",
  OVERHEAD:          "#999999",
  UNRESOLVED:        "#FF3333",
};

type VatPreset = { label: string; rate: number | null; status: string };
const VAT_OPTIONS: VatPreset[] = [
  { label: "Standard 20%",   rate: 20, status: "STANDARD" },
  { label: "Reduced 5%",     rate: 5,  status: "REDUCED" },
  { label: "Zero 0%",        rate: 0,  status: "ZERO" },
  { label: "Reverse Charge", rate: 0,  status: "REVERSE_CHARGE" },
];

function vatKey(rate: string | number | null, status: string | null): string {
  if (status === "REVERSE_CHARGE") return "REVERSE_CHARGE|0";
  const r = rate == null ? "" : String(Number(rate));
  return `${status ?? ""}|${r}`;
}

function isLineComplete(l: BillLine): boolean {
  return Boolean(l.glAccountId && l.vatStatus && l.ticketId);
}

function isTicketOpen(t: TicketOption): boolean {
  return t.status !== "CLOSED" && t.status !== "INVOICED" && t.status !== "LOCKED";
}

function topMatchPct(m: LineMatch): number | null {
  if (m.overallConfidence == null) return null;
  const n = typeof m.overallConfidence === "string" ? Number(m.overallConfidence) : m.overallConfidence;
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

export function BillDetailView({ billId }: { billId: string }) {
  const router = useRouter();
  const [bill, setBill] = useState<Bill | null>(null);
  const [tickets, setTickets] = useState<TicketOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [sitesByCustomer, setSitesByCustomer] = useState<Record<string, SiteOption[]>>({});
  const [glBuckets, setGlBuckets] = useState<GlBucketOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitFor, setSplitFor] = useState<string | null>(null);
  const [reassignFor, setReassignFor] = useState<string | null>(null);
  const [custFor, setCustFor] = useState<string | null>(null);
  const [siteFor, setSiteFor] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [ticketInput, setTicketInput] = useState("");
  const [splitInput, setSplitInput] = useState("");
  const [ticketSearch, setTicketSearch] = useState<Record<string, string>>({});
  const [ticketDropdownFor, setTicketDropdownFor] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState<Record<string, string>>({});
  const [customerDropdownFor, setCustomerDropdownFor] = useState<string | null>(null);
  const [siteDropdownFor, setSiteDropdownFor] = useState<string | null>(null);
  const [pdfMaximized, setPdfMaximized] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineEdits, setLineEdits] = useState<{ description: string; qty: string; unitCost: string }>({
    description: "",
    qty: "",
    unitCost: "",
  });
  const [showAddLine, setShowAddLine] = useState(false);
  const [newLine, setNewLine] = useState<{ description: string; qty: string; unitCost: string }>({
    description: "",
    qty: "1",
    unitCost: "0",
  });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const ticketDropdownRef = useRef<HTMLDivElement | null>(null);
  const customerDropdownRef = useRef<HTMLDivElement | null>(null);
  const siteDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuFor) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuFor]);

  useEffect(() => {
    if (!ticketDropdownFor) return;
    function onDocClick(e: MouseEvent) {
      if (ticketDropdownRef.current && !ticketDropdownRef.current.contains(e.target as Node)) {
        setTicketDropdownFor(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [ticketDropdownFor]);

  useEffect(() => {
    if (!customerDropdownFor) return;
    function onDocClick(e: MouseEvent) {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target as Node)) {
        setCustomerDropdownFor(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [customerDropdownFor]);

  useEffect(() => {
    if (!siteDropdownFor) return;
    function onDocClick(e: MouseEvent) {
      if (siteDropdownRef.current && !siteDropdownRef.current.contains(e.target as Node)) {
        setSiteDropdownFor(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [siteDropdownFor]);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/supplier-bills/${billId}`);
    const data = await r.json();
    if (data?.id) setBill(data);
  }, [billId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    fetch("/api/tickets")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTickets(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/customers")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCustomers(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/chart-of-accounts/bill-buckets")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setGlBuckets(data);
      })
      .catch(() => {});
  }, []);

  // Lazy-load sites per customer when needed.
  const loadSitesForCustomer = useCallback(async (customerId: string) => {
    if (sitesByCustomer[customerId]) return;
    try {
      const r = await fetch(`/api/customers/${customerId}/sites`);
      const data = await r.json();
      if (Array.isArray(data)) {
        setSitesByCustomer((s) => ({ ...s, [customerId]: data }));
      }
    } catch {
      // ignore
    }
  }, [sitesByCustomer]);

  // Pre-load sites for any customer already assigned to a line.
  useEffect(() => {
    if (!bill) return;
    const ids = new Set<string>();
    for (const l of bill.lines) if (l.customerId) ids.add(l.customerId);
    for (const id of ids) loadSitesForCustomer(id);
  }, [bill, loadSitesForCustomer]);

  async function postJson(url: string, body: unknown, method: "POST" | "PUT" | "PATCH" | "DELETE" = "POST") {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(body),
      });
      const j = r.status === 204 ? null : await r.json();
      if (!r.ok) {
        setError((j && j.error) || `HTTP ${r.status}`);
        return null;
      }
      await refresh();
      return j ?? { ok: true };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function patchLine(lineId: string, fields: Record<string, unknown>) {
    return postJson(`/api/supplier-bills/${billId}/lines/${lineId}`, fields, "PATCH");
  }

  async function deleteLine(line: BillLine) {
    if (!confirm(`Delete line: ${line.description.slice(0, 60)}?`)) return;
    return postJson(`/api/supplier-bills/${billId}/lines/${line.id}`, null, "DELETE");
  }

  async function addLine() {
    const description = newLine.description.trim();
    const qty = Number(newLine.qty);
    const unitCost = Number(newLine.unitCost);
    if (!description) { setError("Description required"); return; }
    if (!Number.isFinite(qty) || qty <= 0) { setError("Qty must be positive"); return; }
    if (!Number.isFinite(unitCost)) { setError("Unit cost must be a number"); return; }
    const created = await postJson(`/api/supplier-bills/${billId}/lines`, { description, qty, unitCost });
    if (created) {
      setShowAddLine(false);
      setNewLine({ description: "", qty: "1", unitCost: "0" });
    }
  }

  async function moveLineTo(line: BillLine, type: Allocation["allocationType"], extra: Partial<Allocation> = {}) {
    return postJson(
      `/api/supplier-bills/${billId}/lines/${line.id}/allocations`,
      {
        allocations: [
          {
            type,
            qty: Number(line.qty),
            ticketId: extra.ticketId ?? null,
            ticketLineId: extra.ticketLineId ?? null,
            siteId: extra.siteId ?? null,
            customerId: extra.customerId ?? null,
            reason: `Manual: ${type}`,
          },
        ],
      },
      "PUT"
    );
  }

  async function splitLine(line: BillLine) {
    const qty = Number(splitInput);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Split qty must be a positive number");
      return;
    }
    if (qty >= Number(line.qty)) {
      setError(`Split qty must be less than ${Number(line.qty)}`);
      return;
    }
    setSplitFor(null);
    setSplitInput("");
    await postJson(`/api/supplier-bills/${billId}/lines/${line.id}/split`, { qty });
  }

  async function reallocate(line: BillLine) {
    await postJson(`/api/supplier-bills/${billId}/lines/${line.id}/reallocate`, {});
  }

  async function reassignToTicket(line: BillLine) {
    const ticketId = ticketInput.trim();
    if (!ticketId) {
      setError("Ticket ID required");
      return;
    }
    setReassignFor(null);
    setTicketInput("");
    await moveLineTo(line, "TICKET_LINE", { ticketId });
  }

  // Cascade helpers — clear downstream when upstream changes.
  async function setLineCustomer(line: BillLine, customerId: string | null) {
    await patchLine(line.id, { customerId, siteId: null, ticketId: null });
    if (customerId) loadSitesForCustomer(customerId);
  }
  async function setLineSite(line: BillLine, siteId: string | null) {
    await patchLine(line.id, { siteId, ticketId: null });
  }
  async function setLineTicket(line: BillLine, ticketId: string | null) {
    await patchLine(line.id, { ticketId });
  }

  function startEditLine(l: BillLine) {
    setEditingLineId(l.id);
    setLineEdits({
      description: l.description,
      qty: String(l.qty),
      unitCost: String(l.unitCost),
    });
  }
  async function saveEditLine(l: BillLine) {
    const description = lineEdits.description.trim();
    const qty = Number(lineEdits.qty);
    const unitCost = Number(lineEdits.unitCost);
    if (!description) { setError("Description cannot be empty"); return; }
    if (!Number.isFinite(qty) || qty <= 0) { setError("Qty must be positive"); return; }
    if (!Number.isFinite(unitCost)) { setError("Unit cost must be a number"); return; }
    const updated = await patchLine(l.id, { description, qty, unitCost });
    if (updated) setEditingLineId(null);
  }

  // Find best suggestion for a given dropdown.
  function suggestionFor(line: BillLine, kind: "customer" | "site" | "ticket"): { match: LineMatch; pct: number | null; label: string } | null {
    const matches = line.billLineMatches || [];
    for (const m of matches) {
      if (m.candidateType !== "TICKET_LINE") continue;
      const c = m.candidate;
      if (!c) continue;
      if (kind === "customer" && c.customer) {
        return { match: m, pct: topMatchPct(m), label: c.customer.name };
      }
      if (kind === "site" && c.site) {
        return { match: m, pct: topMatchPct(m), label: c.site.siteName };
      }
      if (kind === "ticket" && c.ticketId) {
        return {
          match: m,
          pct: topMatchPct(m),
          label: `#${c.ticketNo ?? "?"} ${(c.ticketTitle ?? "").slice(0, 24)}`,
        };
      }
    }
    return null;
  }

  async function acceptSuggestion(line: BillLine, kind: "customer" | "site" | "ticket", s: { match: LineMatch }) {
    const c = s.match.candidate;
    if (!c) return;
    if (kind === "customer" && c.customer) {
      await setLineCustomer(line, c.customer.id);
    } else if (kind === "site" && c.site) {
      // Setting site without customer would orphan; ensure customer is set first if missing.
      if (!line.customerId && c.customer) {
        await patchLine(line.id, { customerId: c.customer.id, siteId: c.site.id, ticketId: null });
        loadSitesForCustomer(c.customer.id);
      } else {
        await setLineSite(line, c.site.id);
      }
    } else if (kind === "ticket" && c.ticketId) {
      // Cascade: set customer + site + ticket together so line stays consistent.
      const fields: Record<string, unknown> = { ticketId: c.ticketId };
      if (c.customer) fields.customerId = c.customer.id;
      if (c.site) fields.siteId = c.site.id;
      await patchLine(line.id, fields);
      if (c.customer) loadSitesForCustomer(c.customer.id);
    }
  }

  async function saveAndNext() {
    if (!bill) return;
    const incomplete = bill.lines.filter((l) => !isLineComplete(l));
    if (incomplete.length > 0) {
      setError(`${incomplete.length} line(s) missing Account / VAT / Project`);
      return;
    }
    const posted = await postJson(`/api/supplier-bills/${billId}`, { status: "POSTED" }, "PATCH");
    if (!posted) return;

    const r = await fetch("/api/supplier-bills?status=PENDING");
    const list = await r.json();
    if (Array.isArray(list)) {
      const next = list.find((b: { id: string }) => b.id !== billId);
      if (next?.id) {
        router.push(`/bills/${next.id}`);
        return;
      }
    }
    router.push("/bills");
  }

  const totals = useMemo(() => {
    if (!bill) return null;
    const sum = bill.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
    return { sum };
  }, [bill]);

  const openTickets = useMemo(() => tickets.filter(isTicketOpen), [tickets]);

  const incompleteCount = useMemo(() => {
    if (!bill) return 0;
    return bill.lines.filter((l) => !isLineComplete(l)).length;
  }, [bill]);

  if (!bill) return <div className="text-[11px] text-[#888888] bb-mono">Loading…</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-[#333333] pb-3">
        <div>
          <Link href="/bills" className="text-[10px] tracking-widest text-[#888888] bb-mono hover:text-[#FF6600]">
            ← BILLS
          </Link>
          <div className="mt-1 text-sm tracking-[0.3em] uppercase bb-mono text-[#FF6600]">
            {bill.supplier.name} · {bill.billNo}
          </div>
          <div className="text-[11px] text-[#888888] bb-mono mt-1">
            {new Date(bill.billDate).toLocaleDateString("en-GB")}
            {bill.customerRef && <span className="ml-3">CUST REF: {bill.customerRef}</span>}
            {bill.siteRef && <span className="ml-3">SITE REF: {bill.siteRef}</span>}
          </div>
        </div>
        <div className="flex items-start gap-4">
          <div className="text-right bb-mono">
            <div className="text-[10px] tracking-widest text-[#888888]">STATUS</div>
            <div className="text-[11px] text-[#FF6600]">{bill.status}</div>
            <div className="text-[10px] tracking-widest text-[#888888] mt-2">TOTAL</div>
            <div className="text-sm text-[#CCCCCC]">£ {fmt(bill.totalCost)}</div>
            {totals && Math.abs(totals.sum - Number(bill.totalCost)) > 0.01 && (
              <div className="text-[10px] text-[#FF9900] mt-1">Lines sum: £{fmt(totals.sum)}</div>
            )}
          </div>
          <button
            onClick={saveAndNext}
            disabled={busy || incompleteCount > 0}
            title={incompleteCount > 0 ? `${incompleteCount} line(s) need Account / VAT / Project` : "Mark POSTED and open next pending bill"}
            className="text-[11px] tracking-widest bb-mono border border-[#FF6600] text-[#FF6600] px-4 py-2 hover:bg-[#FF6600] hover:text-[#0A0A0A] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            SAVE &amp; NEXT →
          </button>
        </div>
      </div>

      {error && (
        <div className="text-[11px] text-[#FF3333] bb-mono border border-[#FF3333] px-3 py-2">
          {error}
        </div>
      )}

      {/* Layout: 50/50 by default; full-width source when maximized. */}
      <div className={pdfMaximized ? "grid grid-cols-1 gap-4" : "grid grid-cols-2 gap-4"}>
        <div
          id="source-preview-container"
          className={`border border-[#2A2A2A] bg-[#0A0A0A] flex flex-col ${pdfMaximized ? "h-[85vh]" : "max-h-[80vh]"}`}
        >
          <div className="flex items-center justify-between border-b border-[#2A2A2A] px-3 py-2">
            <div className="text-[10px] tracking-widest text-[#888888] bb-mono">SOURCE</div>
            <button
              type="button"
              onClick={() => setPdfMaximized((v) => !v)}
              className="text-[10px] tracking-widest bb-mono text-[#888888] hover:text-[#FF6600] border border-[#333333] px-2 py-0.5"
            >
              {pdfMaximized ? "⛶ RESTORE" : "⛶ MAXIMIZE"}
            </button>
          </div>
          {bill.intakeDocument?.id && bill.intakeDocument.fileRef ? (
            <SourcePdfPreview intakeDocumentId={bill.intakeDocument.id} className="flex-1" />
          ) : bill.intakeDocument?.rawText ? (
            <pre className="font-mono text-xs whitespace-pre-wrap overflow-auto text-[#CCCCCC] p-3">
              {bill.intakeDocument.rawText}
            </pre>
          ) : (
            <div className="text-[11px] text-[#666666] bb-mono p-3">No source available.</div>
          )}
        </div>

        <div className={`border border-[#2A2A2A] ${pdfMaximized ? "hidden" : ""}`}>
          <table className="w-full text-[11px] bb-mono">
            <thead className="bg-[#1A1A1A] text-[#888888] uppercase tracking-widest">
              <tr>
                <th className="text-left px-2 py-2">Description</th>
                <th className="text-right px-2 py-2">Qty</th>
                <th className="text-right px-2 py-2">Total</th>
                <th className="text-left px-2 py-2">Account</th>
                <th className="text-left px-2 py-2">VAT</th>
                <th className="text-left px-2 py-2">Customer / Site / Ticket</th>
                <th className="text-right px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((l) => {
                const lineAllocs = l.billLineAllocations || [];
                const posted = lineAllocs.some(
                  (a) => a.costAllocationId || a.returnId || a.stockExcessRecordId || a.absorbedAllocationId
                );
                const currentVatKey = vatKey(l.vatRate, l.vatStatus);
                const search = ticketSearch[l.id] ?? "";
                const lower = search.toLowerCase();
                const filteredTickets = openTickets.filter((t) => {
                  if (l.customerId && t.payingCustomerId && t.payingCustomerId !== l.customerId) return false;
                  if (l.siteId && t.siteId && t.siteId !== l.siteId) return false;
                  if (!lower) return true;
                  return (
                    String(t.ticketNo).includes(lower) ||
                    t.title.toLowerCase().includes(lower)
                  );
                }).slice(0, 30);
                const currentTicket = tickets.find((t) => t.id === l.ticketId) ?? null;
                const currentCustomer = customers.find((c) => c.id === l.customerId)
                  ?? (l.customer ? { id: l.customer.id, name: l.customer.name } : null);
                const customerSearchVal = (customerSearch[l.id] ?? "").toLowerCase();
                const filteredCustomers = customers.filter((c) => {
                  if (!customerSearchVal) return true;
                  return (
                    c.name.toLowerCase().includes(customerSearchVal) ||
                    (c.legalName ?? "").toLowerCase().includes(customerSearchVal)
                  );
                }).slice(0, 30);
                const sitesForCust = (l.customerId ? sitesByCustomer[l.customerId] : null) ?? [];
                const currentSite = sitesForCust.find((s) => s.id === l.siteId)
                  ?? (l.site ? { id: l.site.id, siteName: l.site.siteName } : null);

                const sugCust = !l.customerId ? suggestionFor(l, "customer") : null;
                const sugSite = !l.siteId && l.customerId ? suggestionFor(l, "site") : null;
                const sugTicket = !l.ticketId ? suggestionFor(l, "ticket") : null;

                const isEditing = editingLineId === l.id;

                return (
                  <tr key={l.id} className="border-t border-[#222222] align-top">
                    <td className="px-2 py-2 text-[#CCCCCC]">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={lineEdits.description}
                          onChange={(e) => setLineEdits((s) => ({ ...s, description: e.target.value }))}
                          className="w-full bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[11px] px-1 py-1"
                        />
                      ) : (
                        <>
                          <div>{l.description}</div>
                          {l.productCode && (
                            <div className="text-[10px] text-[#666666] mt-0.5">{l.productCode}</div>
                          )}
                        </>
                      )}
                      {lineAllocs.length > 0 && (
                        <div className="space-y-0.5 mt-1">
                          {lineAllocs.map((a) => {
                            const margin = a.marginAllocated;
                            const marginColour =
                              margin == null ? "#666666" : margin >= 0 ? "#00CC66" : "#FF6666";
                            return (
                              <div key={a.id} className="text-[10px]">
                                <span style={{ color: ALLOC_COLOUR[a.allocationType] }}>{a.allocationType}</span>
                                <span className="text-[#888888]"> · {fmt(a.qtyAllocated)} @ £{fmt(a.costAllocated)}</span>
                                {a.resolvedSite && (
                                  <span className="text-[#CCCCCC]"> · {a.resolvedSite.siteName}</span>
                                )}
                                {a.resolvedCustomer && (
                                  <span className="text-[#FFCC00]"> · {a.resolvedCustomer.name}</span>
                                )}
                                {a.saleAllocated != null && (
                                  <>
                                    <span className="text-[#888888]"> · sale £{fmt(a.saleAllocated)}</span>
                                    <span style={{ color: marginColour }}> · margin £{fmt(margin)}</span>
                                  </>
                                )}
                                {(a.costAllocationId || a.returnId || a.stockExcessRecordId || a.absorbedAllocationId) && (
                                  <span className="text-[#00CC66]"> · POSTED</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right text-[#CCCCCC]">
                      {isEditing ? (
                        <input
                          value={lineEdits.qty}
                          onChange={(e) => setLineEdits((s) => ({ ...s, qty: e.target.value }))}
                          className="w-16 bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[10px] px-1 py-1 text-right"
                        />
                      ) : (
                        fmt(l.qty)
                      )}
                    </td>
                    <td className="px-2 py-2 text-right text-[#CCCCCC]">
                      {isEditing ? (
                        <input
                          value={lineEdits.unitCost}
                          onChange={(e) => setLineEdits((s) => ({ ...s, unitCost: e.target.value }))}
                          placeholder="unit £"
                          className="w-20 bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[10px] px-1 py-1 text-right"
                        />
                      ) : (
                        fmt(l.lineTotal)
                      )}
                    </td>

                    <td className="px-2 py-2">
                      <select
                        value={l.glAccountId ?? ""}
                        disabled={busy || posted}
                        onChange={(e) =>
                          patchLine(l.id, { glAccountId: e.target.value || null })
                        }
                        className="bg-[#1A1A1A] border border-[#2A2A2A] text-[#CCCCCC] bb-mono text-[10px] px-1 py-1 w-full"
                      >
                        <option value="">— Account —</option>
                        {glBuckets.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.label} — {g.accountCode}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-2 py-2">
                      <select
                        value={currentVatKey}
                        disabled={busy || posted}
                        onChange={(e) => {
                          const opt = VAT_OPTIONS.find((o) => `${o.status}|${o.rate}` === e.target.value);
                          if (!opt) return;
                          patchLine(l.id, { vatRate: opt.rate, vatStatus: opt.status });
                        }}
                        className="bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[10px] px-1 py-1 w-full"
                      >
                        <option value="">— VAT —</option>
                        {VAT_OPTIONS.map((opt) => (
                          <option key={`${opt.status}|${opt.rate}`} value={`${opt.status}|${opt.rate}`}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Customer / Site / Ticket cascade */}
                    <td className="px-2 py-2 relative">
                      <div className="space-y-1">
                        {/* Customer dropdown */}
                        {sugCust && (
                          <button
                            type="button"
                            disabled={busy || posted}
                            onClick={() => acceptSuggestion(l, "customer", sugCust)}
                            className="block w-full text-left text-[10px] bb-mono text-[#FF9900] hover:text-[#FFCC00] disabled:opacity-50"
                            title="AI suggestion — click to accept"
                          >
                            [SUGGESTED{sugCust.pct != null ? ` ${sugCust.pct}%` : ""} · {sugCust.label}]
                          </button>
                        )}
                        <div ref={customerDropdownFor === l.id ? customerDropdownRef : null} className="relative">
                          <button
                            type="button"
                            disabled={busy || posted}
                            onClick={() => setCustomerDropdownFor(customerDropdownFor === l.id ? null : l.id)}
                            className="bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[10px] px-2 py-1 w-full text-left disabled:opacity-50"
                          >
                            {currentCustomer
                              ? <><span className="text-[#FFCC00]">{currentCustomer.name}</span></>
                              : <span className="text-[#666666]">— pick customer —</span>}
                          </button>
                          {customerDropdownFor === l.id && (
                            <div className="absolute right-0 left-0 mt-1 z-30 bg-[#0D0D0D] border border-[#333333] shadow-lg max-h-64 overflow-auto">
                              <input
                                autoFocus
                                value={customerSearch[l.id] ?? ""}
                                onChange={(e) => setCustomerSearch((s) => ({ ...s, [l.id]: e.target.value }))}
                                placeholder="search customer"
                                className="w-full bg-[#0A0A0A] border-b border-[#333333] text-[#CCCCCC] text-[10px] px-2 py-1.5"
                              />
                              {l.customerId && (
                                <button
                                  onClick={() => {
                                    setCustomerDropdownFor(null);
                                    setLineCustomer(l, null);
                                  }}
                                  className="block w-full text-left px-2 py-1.5 text-[10px] bb-mono text-[#FF6666] hover:bg-[#1A1A1A]"
                                >
                                  ✕ clear
                                </button>
                              )}
                              {filteredCustomers.length === 0 && (
                                <div className="px-2 py-2 text-[10px] text-[#666666]">no matches</div>
                              )}
                              {filteredCustomers.map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => {
                                    setCustomerDropdownFor(null);
                                    setCustomerSearch((s) => ({ ...s, [l.id]: "" }));
                                    setLineCustomer(l, c.id);
                                  }}
                                  className="block w-full text-left px-2 py-1.5 text-[10px] bb-mono text-[#CCCCCC] hover:bg-[#1A1A1A]"
                                >
                                  {c.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Site dropdown */}
                        {sugSite && (
                          <button
                            type="button"
                            disabled={busy || posted}
                            onClick={() => acceptSuggestion(l, "site", sugSite)}
                            className="block w-full text-left text-[10px] bb-mono text-[#FF9900] hover:text-[#FFCC00] disabled:opacity-50"
                            title="AI suggestion — click to accept"
                          >
                            [SUGGESTED{sugSite.pct != null ? ` ${sugSite.pct}%` : ""} · {sugSite.label}]
                          </button>
                        )}
                        <div ref={siteDropdownFor === l.id ? siteDropdownRef : null} className="relative">
                          <button
                            type="button"
                            disabled={busy || posted || !l.customerId}
                            onClick={() => setSiteDropdownFor(siteDropdownFor === l.id ? null : l.id)}
                            className="bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[10px] px-2 py-1 w-full text-left disabled:opacity-30"
                          >
                            {currentSite
                              ? <span className="text-[#CCCCCC]">{currentSite.siteName}</span>
                              : <span className="text-[#666666]">{l.customerId ? "— pick site —" : "— pick customer first —"}</span>}
                          </button>
                          {siteDropdownFor === l.id && l.customerId && (
                            <div className="absolute right-0 left-0 mt-1 z-30 bg-[#0D0D0D] border border-[#333333] shadow-lg max-h-64 overflow-auto">
                              {l.siteId && (
                                <button
                                  onClick={() => {
                                    setSiteDropdownFor(null);
                                    setLineSite(l, null);
                                  }}
                                  className="block w-full text-left px-2 py-1.5 text-[10px] bb-mono text-[#FF6666] hover:bg-[#1A1A1A]"
                                >
                                  ✕ clear
                                </button>
                              )}
                              {sitesForCust.length === 0 && (
                                <div className="px-2 py-2 text-[10px] text-[#666666]">no sites linked to this customer</div>
                              )}
                              {sitesForCust.map((s) => (
                                <button
                                  key={s.id}
                                  onClick={() => {
                                    setSiteDropdownFor(null);
                                    setLineSite(l, s.id);
                                  }}
                                  className="block w-full text-left px-2 py-1.5 text-[10px] bb-mono text-[#CCCCCC] hover:bg-[#1A1A1A]"
                                >
                                  {s.siteName}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Ticket dropdown */}
                        {sugTicket && (
                          <button
                            type="button"
                            disabled={busy || posted}
                            onClick={() => acceptSuggestion(l, "ticket", sugTicket)}
                            className="block w-full text-left text-[10px] bb-mono text-[#FF9900] hover:text-[#FFCC00] disabled:opacity-50"
                            title="AI suggestion — click to accept"
                          >
                            [SUGGESTED{sugTicket.pct != null ? ` ${sugTicket.pct}%` : ""} · {sugTicket.label}]
                          </button>
                        )}
                        <div ref={ticketDropdownFor === l.id ? ticketDropdownRef : null} className="relative">
                          <button
                            type="button"
                            disabled={busy || posted}
                            onClick={() => setTicketDropdownFor(ticketDropdownFor === l.id ? null : l.id)}
                            className="bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[10px] px-2 py-1 w-full text-left disabled:opacity-50"
                          >
                            {currentTicket
                              ? `#${currentTicket.ticketNo} ${currentTicket.title.slice(0, 24)}`
                              : <span className="text-[#666666]">— pick ticket —</span>}
                          </button>
                          {ticketDropdownFor === l.id && (
                            <div className="absolute right-0 left-0 mt-1 z-30 bg-[#0D0D0D] border border-[#333333] shadow-lg max-h-64 overflow-auto">
                              <input
                                autoFocus
                                value={search}
                                onChange={(e) =>
                                  setTicketSearch((s) => ({ ...s, [l.id]: e.target.value }))
                                }
                                placeholder="search #no or title"
                                className="w-full bg-[#0A0A0A] border-b border-[#333333] text-[#CCCCCC] text-[10px] px-2 py-1.5"
                              />
                              {l.ticketId && (
                                <button
                                  onClick={() => {
                                    setTicketDropdownFor(null);
                                    setLineTicket(l, null);
                                  }}
                                  className="block w-full text-left px-2 py-1.5 text-[10px] bb-mono text-[#FF6666] hover:bg-[#1A1A1A]"
                                >
                                  ✕ clear
                                </button>
                              )}
                              {filteredTickets.length === 0 && (
                                <div className="px-2 py-2 text-[10px] text-[#666666]">no matches</div>
                              )}
                              {filteredTickets.map((t) => (
                                <button
                                  key={t.id}
                                  onClick={() => {
                                    setTicketDropdownFor(null);
                                    setTicketSearch((s) => ({ ...s, [l.id]: "" }));
                                    setLineTicket(l, t.id);
                                  }}
                                  className="block w-full text-left px-2 py-1.5 text-[10px] bb-mono text-[#CCCCCC] hover:bg-[#1A1A1A]"
                                >
                                  <span className="text-[#FF6600]">#{t.ticketNo}</span> {t.title}
                                  <span className="text-[#666666] ml-2">{t.status}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-2 py-2 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => saveEditLine(l)}
                            disabled={busy}
                            className="text-[10px] bb-mono text-[#FF6600] hover:underline disabled:opacity-50"
                          >
                            SAVE
                          </button>
                          <button
                            onClick={() => setEditingLineId(null)}
                            className="text-[10px] bb-mono text-[#666666] hover:text-[#CCCCCC]"
                          >
                            ✕
                          </button>
                        </div>
                      ) : posted ? (
                        <span className="text-[10px] text-[#666666]">locked</span>
                      ) : splitFor === l.id ? (
                        <div className="flex justify-end gap-1">
                          <input
                            autoFocus
                            value={splitInput}
                            onChange={(e) => setSplitInput(e.target.value)}
                            placeholder="qty"
                            className="w-14 bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[10px] px-1 py-0.5"
                          />
                          <button
                            onClick={() => splitLine(l)}
                            disabled={busy}
                            className="text-[10px] bb-mono text-[#FF6600] hover:underline disabled:opacity-50"
                          >
                            OK
                          </button>
                          <button
                            onClick={() => { setSplitFor(null); setSplitInput(""); }}
                            className="text-[10px] bb-mono text-[#666666] hover:text-[#CCCCCC]"
                          >
                            ✕
                          </button>
                        </div>
                      ) : reassignFor === l.id ? (
                        <div className="flex justify-end gap-1">
                          <input
                            autoFocus
                            value={ticketInput}
                            onChange={(e) => setTicketInput(e.target.value)}
                            placeholder="ticket id"
                            className="w-32 bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[10px] px-1 py-0.5"
                          />
                          <button
                            onClick={() => reassignToTicket(l)}
                            disabled={busy}
                            className="text-[10px] bb-mono text-[#FF6600] hover:underline disabled:opacity-50"
                          >
                            OK
                          </button>
                          <button
                            onClick={() => { setReassignFor(null); setTicketInput(""); }}
                            className="text-[10px] bb-mono text-[#666666] hover:text-[#CCCCCC]"
                          >
                            ✕
                          </button>
                        </div>
                      ) : custFor === l.id ? (
                        <div className="flex justify-end">
                          <LineCustomerSwap
                            billId={billId}
                            lineId={l.id}
                            currentCustomer={l.customer}
                            disabled={busy}
                            alwaysOpen
                            onClose={() => setCustFor(null)}
                          />
                        </div>
                      ) : siteFor === l.id ? (
                        <div className="flex justify-end">
                          <LineSiteSwap
                            billId={billId}
                            lineId={l.id}
                            currentSite={l.site}
                            disabled={busy}
                            onClose={() => setSiteFor(null)}
                          />
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1 items-center">
                          <button
                            onClick={() => startEditLine(l)}
                            disabled={busy}
                            title="Edit description / qty / unit cost"
                            className="text-[10px] bb-mono text-[#888888] hover:text-[#FF6600] border border-[#333333] px-1.5 py-0.5 disabled:opacity-50"
                          >
                            ✎
                          </button>
                          <div className="relative inline-block" ref={menuFor === l.id ? menuRef : null}>
                            <button
                              onClick={() => setMenuFor(menuFor === l.id ? null : l.id)}
                              disabled={busy}
                              className="text-[10px] bb-mono text-[#CCCCCC] hover:text-[#FF6600] border border-[#333333] px-2 py-0.5 disabled:opacity-50"
                            >
                              ▾
                            </button>
                            {menuFor === l.id && (
                              <div className="absolute right-0 mt-1 z-10 min-w-[140px] bg-[#0D0D0D] border border-[#333333] shadow-lg">
                                <button
                                  onClick={() => { setMenuFor(null); setSplitFor(l.id); }}
                                  disabled={busy}
                                  className="block w-full text-left px-3 py-1.5 text-[10px] bb-mono text-[#CCCCCC] hover:bg-[#1A1A1A] disabled:opacity-50"
                                >
                                  SPLIT
                                </button>
                                <button
                                  onClick={() => { setMenuFor(null); moveLineTo(l, "STOCK"); }}
                                  disabled={busy}
                                  className="block w-full text-left px-3 py-1.5 text-[10px] bb-mono text-[#3399FF] hover:bg-[#1A1A1A] disabled:opacity-50"
                                >
                                  → STOCK
                                </button>
                                <button
                                  onClick={() => { setMenuFor(null); moveLineTo(l, "RETURNS_CANDIDATE"); }}
                                  disabled={busy}
                                  className="block w-full text-left px-3 py-1.5 text-[10px] bb-mono text-[#FF9900] hover:bg-[#1A1A1A] disabled:opacity-50"
                                >
                                  → RETURN
                                </button>
                                <button
                                  onClick={() => { setMenuFor(null); setReassignFor(l.id); }}
                                  disabled={busy}
                                  className="block w-full text-left px-3 py-1.5 text-[10px] bb-mono text-[#00CC66] hover:bg-[#1A1A1A] disabled:opacity-50"
                                >
                                  → TICKET
                                </button>
                                <button
                                  onClick={() => { setMenuFor(null); setCustFor(l.id); }}
                                  disabled={busy}
                                  className="block w-full text-left px-3 py-1.5 text-[10px] bb-mono text-[#FFCC00] hover:bg-[#1A1A1A] disabled:opacity-50"
                                >
                                  → CUST
                                </button>
                                <button
                                  onClick={() => { setMenuFor(null); setSiteFor(l.id); }}
                                  disabled={busy}
                                  className="block w-full text-left px-3 py-1.5 text-[10px] bb-mono text-[#FFAA66] hover:bg-[#1A1A1A] disabled:opacity-50"
                                >
                                  → SITE
                                </button>
                                <button
                                  onClick={() => { setMenuFor(null); reallocate(l); }}
                                  disabled={busy}
                                  className="block w-full text-left px-3 py-1.5 text-[10px] bb-mono text-[#888888] hover:bg-[#1A1A1A] hover:text-[#FF6600] disabled:opacity-50"
                                >
                                  AUTO
                                </button>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => deleteLine(l)}
                            disabled={busy}
                            title="Delete line"
                            className="text-[10px] bb-mono text-[#FF3333] hover:text-[#FF6666] border border-[#333333] px-1.5 py-0.5 disabled:opacity-50"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {showAddLine && (
                <tr className="border-t border-[#222222] bg-[#0D0D0D]">
                  <td className="px-2 py-2">
                    <input
                      autoFocus
                      value={newLine.description}
                      onChange={(e) => setNewLine((s) => ({ ...s, description: e.target.value }))}
                      placeholder="description"
                      className="w-full bg-[#0A0A0A] border border-[#333333] text-[#CCCCCC] text-[11px] px-1 py-1"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      value={newLine.qty}
                      onChange={(e) => setNewLine((s) => ({ ...s, qty: e.target.value }))}
                      className="w-16 bg-[#0A0A0A] border border-[#333333] text-[#CCCCCC] text-[10px] px-1 py-1 text-right"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      value={newLine.unitCost}
                      onChange={(e) => setNewLine((s) => ({ ...s, unitCost: e.target.value }))}
                      placeholder="unit £"
                      className="w-20 bg-[#0A0A0A] border border-[#333333] text-[#CCCCCC] text-[10px] px-1 py-1 text-right"
                    />
                  </td>
                  <td colSpan={3} className="px-2 py-2 text-[10px] text-[#666666]">
                    Defaults: Materials / VAT 20% / Unallocated
                  </td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={addLine}
                        disabled={busy}
                        className="text-[10px] bb-mono text-[#FF6600] hover:underline disabled:opacity-50"
                      >
                        SAVE
                      </button>
                      <button
                        onClick={() => { setShowAddLine(false); setNewLine({ description: "", qty: "1", unitCost: "0" }); }}
                        className="text-[10px] bb-mono text-[#666666] hover:text-[#CCCCCC]"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {!showAddLine && (
            <div className="border-t border-[#2A2A2A] px-2 py-2">
              <button
                onClick={() => setShowAddLine(true)}
                disabled={busy}
                className="text-[10px] tracking-widest bb-mono text-[#FF6600] hover:text-[#FFCC00] border border-[#333333] px-2 py-1 disabled:opacity-50"
              >
                + ADD LINE
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
