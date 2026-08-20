"use client";

import { Button } from "@/components/ui/button";

type Line = {
  description: string;
  qty: number;
  sellUnit: number;
  costUnit: number;
  supplier: string | null;
  delivered: number;
};
type CallOff = {
  id: string;
  no: number;
  coSeq: number;
  date: string;
  status: string;
  lines: Line[];
};
type Props = {
  poNo: string;
  customerName: string;
  siteName: string;
  vatRate: number;
  callOffs: CallOff[];
  poQty: Record<string, number>;
  deliveryNotes: { no: number; coSeq: number; qtyByDescription: Record<string, number> }[];
  /** Per item description: ready-to-render substitution link lines (from/to · CO · date). */
  substitutions?: Record<string, string[]>;
  /** Explicit per-swap summary shown to the client (when · what · why · balance/over). */
  substitutionSummary?: { co: string; date: string; from: string; to: string; reason: string; balance: number; supplied: number; over: number }[];
};

const gbp = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function LoggedCallOffs({ poNo, customerName, siteName, vatRate, callOffs = [], poQty = {}, deliveryNotes = [], substitutions = {}, substitutionSummary = [] }: Props) {
  function open(html: string) {
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  }
  // Substitution link lines (from/to · CO · date) — travel onto every document
  // (client + internal) in place of a prose note.
  const subLines = (desc: string): string[] => substitutions[desc] ?? [];
  const noteHtml = (desc: string) =>
    subLines(desc)
      .map((l) => `<div style="font-size:9px;color:#7c3aed;font-weight:600">${l}</div>`)
      .join("");

  // Explicit substitutions block for client docs — spells out each swap so the
  // aggregate PO-qty / over figures are self-explaining.
  const subSummaryHtml = substitutionSummary.length
    ? `<div style="font-size:12px;font-weight:700;margin-top:18px;text-transform:uppercase;letter-spacing:0.5px">Substitutions</div>
      <table>
        <thead><tr><th>Call-off</th><th>Substituted</th><th class="r">Ordered balance</th><th class="r">Supplied</th><th class="r">Over-supplied</th></tr></thead>
        <tbody>${substitutionSummary
          .map((s) => `<tr><td>${s.co}${s.date ? ` · ${s.date}` : ""}</td><td>${s.from} &rarr; ${s.to}</td><td class="r">${s.balance}</td><td class="r">${s.supplied}</td><td class="r"${s.over > 0 ? ' style="color:#b91c1c;font-weight:700"' : ""}>${s.over > 0 ? `${s.over} over` : "—"}</td></tr>`)
          .join("")}</tbody>
        <tfoot><tr><td colspan="2" class="r">Total</td><td class="r">${substitutionSummary.reduce((a, s) => a + s.balance, 0)}</td><td class="r">${substitutionSummary.reduce((a, s) => a + s.supplied, 0)}</td><td class="r">${substitutionSummary.reduce((a, s) => a + s.over, 0)} over</td></tr></tfoot>
      </table>`
    : "";

  const shell = (title: string, body: string) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; padding:30px 40px; font-size:12px; color:#000; }
    h1 { font-size:18px; font-weight:800; } .sub { font-size:11px; color:#555; margin-top:2px; }
    hr { border:none; border-top:2px solid #000; margin:12px 0; }
    .ref { font-size:13px; font-weight:600; margin-top:12px; }
    .meta { font-size:11px; color:#555; margin-top:2px; margin-bottom:16px; }
    table { width:100%; border-collapse:collapse; margin-top:8px; }
    th { text-align:left; padding:6px 8px; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid #000; font-weight:700; }
    td { padding:5px 8px; border-bottom:1px solid #ddd; font-size:11px; }
    tfoot td { border-bottom:none; font-weight:700; }
    .r { text-align:right; } @page { margin:15mm; }
  </style></head><body>
    <h1>Cromwell Plumbing Ltd</h1>
    <div class="sub">${title}</div>
    <hr />
    <div class="ref">${customerName}${siteName ? ` — ${siteName}` : ""}</div>
    ${body}
  </body></html>`;

  function printClient(co: CallOff) {
    // Client copy — quantities only (no prices): called-off vs delivered vs outstanding.
    const rows = co.lines.map((l) => {
      const os = Math.max(0, l.qty - l.delivered);
      return `<tr><td>${l.description}${noteHtml(l.description)}</td><td class="r">${l.qty}</td><td class="r">${l.delivered}</td><td class="r">${os || "—"}</td></tr>`;
    }).join("");
    const totQty = co.lines.reduce((s, l) => s + l.qty, 0);
    const totDlv = co.lines.reduce((s, l) => s + l.delivered, 0);
    const body = `
      <div class="meta">Call-off <b>CO${co.coSeq}</b> &nbsp;·&nbsp; PO <b>${poNo}</b> &nbsp;·&nbsp; ${fmtDate(co.date)} &nbsp;·&nbsp; ${co.status}</div>
      <table>
        <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Delivered</th><th class="r">Outstanding</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><td class="r">Totals</td><td class="r">${totQty}</td><td class="r">${totDlv}</td><td class="r">${Math.max(0, totQty - totDlv) || "—"}</td></tr>
        </tfoot>
      </table>`;
    open(shell(`Call-off CO${co.coSeq}`, body));
  }

  function printInternal(co: CallOff) {
    let tCost = 0, tSell = 0;
    const rows = co.lines.map((l) => {
      const cost = l.qty * l.costUnit;
      const sell = l.qty * l.sellUnit;
      const margin = sell - cost;
      const pct = sell > 0 ? (margin / sell) * 100 : 0;
      tCost += cost; tSell += sell;
      return `<tr>
        <td>${l.description}${noteHtml(l.description)}</td>
        <td class="r">${l.qty}</td>
        <td class="r">£${gbp(l.costUnit)}</td>
        <td class="r">£${gbp(l.sellUnit)}</td>
        <td class="r">£${gbp(margin)}</td>
        <td class="r">${pct.toFixed(0)}%</td>
        <td>${l.supplier ?? "—"}</td>
        <td class="r">${l.delivered}/${l.qty}</td>
      </tr>`;
    }).join("");
    const tMargin = tSell - tCost;
    const tPct = tSell > 0 ? (tMargin / tSell) * 100 : 0;
    const body = `
      <div class="meta">Call-off <b>CO${co.coSeq}</b> &nbsp;·&nbsp; PO <b>${poNo}</b> &nbsp;·&nbsp; ${fmtDate(co.date)} &nbsp;·&nbsp; ${co.status} &nbsp;·&nbsp; INTERNAL</div>
      <table>
        <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Cost</th><th class="r">Sell</th><th class="r">Margin</th><th class="r">%</th><th>Supplier</th><th class="r">Dlv/Qty</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><td colspan="2" class="r">Totals</td><td class="r">£${gbp(tCost)}</td><td class="r">£${gbp(tSell)}</td><td class="r">£${gbp(tMargin)}</td><td class="r">${tPct.toFixed(0)}%</td><td colspan="2"></td></tr>
        </tfoot>
      </table>`;
    open(shell(`Call-off CO${co.coSeq} — Internal`, body));
  }

  // Aggregate every call-off line by item → PO qty vs called-off vs delivered,
  // for the PO-wide reconciliation against delivery notes.
  function aggregate() {
    const map = new Map<string, { description: string; calledOff: number; delivered: number; sellUnit: number; costUnit: number; supplier: string | null }>();
    for (const co of callOffs) {
      for (const l of co.lines) {
        const e = map.get(l.description) ?? { description: l.description, calledOff: 0, delivered: 0, sellUnit: l.sellUnit, costUnit: l.costUnit, supplier: l.supplier };
        e.calledOff += l.qty;
        e.delivered += l.delivered;
        map.set(l.description, e);
      }
    }
    return [...map.values()].map((e) => {
      const ordered = poQty[e.description] ?? e.calledOff;
      return { ...e, ordered, remainingPO: Math.max(0, ordered - e.calledOff), outstanding: Math.max(0, e.calledOff - e.delivered), oversupplied: Math.max(0, e.calledOff - ordered) };
    });
  }

  function printReconClient() {
    // Client copy — quantities only, broken down per call-off AND per delivery note.
    const rows = matrix();
    const coHead = callOffs.map((co) => `<th class="r">CO${co.coSeq}</th>`).join("");
    const dnHead = deliveryNotes.map((dn) => `<th class="r">DN${dn.no}</th>`).join("");
    const body = `
      <div class="meta">PO <b>${poNo}</b> &nbsp;·&nbsp; Call-offs reconciled against deliveries &nbsp;·&nbsp; ${fmtDate(new Date().toISOString())}</div>
      <table>
        <thead><tr><th>Description</th><th class="r">PO Qty</th>${coHead}<th class="r">Called off</th><th class="r">Remaining PO</th>${dnHead}<th class="r">Delivered</th><th class="r">Outstanding</th></tr></thead>
        <tbody>${rows.map((r) => {
          const coCells = callOffs.map((co) => `<td class="r">${r.byCO[co.id] ?? "—"}</td>`).join("");
          const dnCells = deliveryNotes.map((dn) => `<td class="r">${dn.qtyByDescription[r.description] ?? "—"}</td>`).join("");
          const bal = r.oversupplied > 0 ? `<span style="color:#b91c1c;font-weight:700">${r.oversupplied} over</span>` : (r.remainingPO || "—");
          return `<tr><td>${r.description}${noteHtml(r.description)}</td><td class="r">${r.ordered}</td>${coCells}<td class="r">${r.calledOff}</td><td class="r">${bal}</td>${dnCells}<td class="r">${r.delivered}</td><td class="r">${r.outstanding || "—"}</td></tr>`;
        }).join("")}</tbody>
      </table>${subSummaryHtml}`;
    open(shell(`Call-off Reconciliation — PO ${poNo}`, body));
  }

  function printReconInternal() {
    const rows = aggregate();
    let tCost = 0, tSell = 0, tRem = 0;
    const body = `
      <div class="meta">PO <b>${poNo}</b> &nbsp;·&nbsp; Reconciliation vs deliveries &nbsp;·&nbsp; ${fmtDate(new Date().toISOString())} &nbsp;·&nbsp; INTERNAL</div>
      <table>
        <thead><tr><th>Description</th><th class="r">PO Qty</th><th class="r">Called</th><th class="r">Rem PO</th><th class="r">Delivered</th><th class="r">O/S</th><th class="r">Cost</th><th class="r">Sell</th><th class="r">Margin</th><th class="r">%</th><th>Supplier</th></tr></thead>
        <tbody>${rows.map((r) => {
          const cost = r.calledOff * r.costUnit, sell = r.calledOff * r.sellUnit, margin = sell - cost;
          const pct = sell > 0 ? (margin / sell) * 100 : 0;
          tCost += cost; tSell += sell; tRem += r.remainingPO * r.sellUnit;
          const bal = r.oversupplied > 0 ? `<span style="color:#b91c1c;font-weight:700">${r.oversupplied} over</span>` : (r.remainingPO || "—");
          return `<tr><td>${r.description}${noteHtml(r.description)}</td><td class="r">${r.ordered}</td><td class="r">${r.calledOff}</td><td class="r">${bal}</td><td class="r">${r.delivered}</td><td class="r">${r.outstanding || "—"}</td><td class="r">£${gbp(r.costUnit)}</td><td class="r">£${gbp(r.sellUnit)}</td><td class="r">£${gbp(margin)}</td><td class="r">${pct.toFixed(0)}%</td><td>${r.supplier ?? "—"}</td></tr>`;
        }).join("")}</tbody>
        <tfoot>
          <tr><td colspan="6" class="r">Totals (on called-off)</td><td class="r">£${gbp(tCost)}</td><td class="r">£${gbp(tSell)}</td><td class="r">£${gbp(tSell - tCost)}</td><td class="r">${tSell > 0 ? ((tSell - tCost) / tSell * 100).toFixed(0) : 0}%</td><td></td></tr>
          <tr><td colspan="10" class="r">Remaining PO balance £ (at sell)</td><td class="r">£${gbp(tRem)}</td></tr>
        </tfoot>
      </table>`;
    open(shell(`Reconciliation (Internal) — PO ${poNo}`, body));
  }

  // Per-item balances: PO qty vs each call-off vs remaining PO vs delivered.
  function matrix() {
    const items = new Map<string, { description: string; byCO: Record<string, number>; delivered: number }>();
    for (const co of callOffs) {
      for (const l of co.lines) {
        const e = items.get(l.description) ?? { description: l.description, byCO: {}, delivered: 0 };
        e.byCO[co.id] = (e.byCO[co.id] ?? 0) + l.qty;
        e.delivered += l.delivered;
        items.set(l.description, e);
      }
    }
    return [...items.values()].map((e) => {
      const calledOff = Object.values(e.byCO).reduce((a, b) => a + b, 0);
      const ordered = poQty[e.description] ?? calledOff;
      return { ...e, calledOff, ordered, remainingPO: Math.max(0, ordered - calledOff), outstanding: Math.max(0, calledOff - e.delivered), oversupplied: Math.max(0, calledOff - ordered) };
    });
  }

  if (callOffs.length === 0) {
    return (
      <div className="rounded border p-3 text-xs text-muted-foreground">
        No call-offs logged on this PO yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
    <div className="rounded border">
      <div className="px-3 py-2 border-b text-xs font-medium flex items-center justify-between">
        <span>Logged call-offs</span>
        <span className="flex gap-1">
          <span className="text-[10px] text-muted-foreground self-center mr-1">Reconcile vs deliveries:</span>
          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={printReconClient}>Client</Button>
          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={printReconInternal}>Internal</Button>
        </span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="px-3 py-1.5 font-normal">Call-off</th>
            <th className="px-3 py-1.5 font-normal">Date</th>
            <th className="px-3 py-1.5 font-normal">Status</th>
            <th className="px-3 py-1.5 font-normal text-right">Lines</th>
            <th className="px-3 py-1.5 font-normal text-right">Qty</th>
            <th className="px-3 py-1.5 font-normal text-right">Sell £</th>
            <th className="px-3 py-1.5 font-normal text-right">Copies</th>
          </tr>
        </thead>
        <tbody>
          {callOffs.map((co) => {
            const qty = co.lines.reduce((s, l) => s + l.qty, 0);
            const sell = co.lines.reduce((s, l) => s + l.qty * l.sellUnit, 0);
            return (
              <tr key={co.id} className="border-t">
                <td className="px-3 py-1.5 font-medium">CO{co.coSeq}</td>
                <td className="px-3 py-1.5">{fmtDate(co.date)}</td>
                <td className="px-3 py-1.5">{co.status}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{co.lines.length}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{qty}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">£{gbp(sell)}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 mr-1" onClick={() => printClient(co)}>Client</Button>
                  <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => printInternal(co)}>Internal</Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {substitutionSummary.length > 0 && (
      <div className="rounded border overflow-x-auto">
        <div className="px-3 py-2 border-b text-xs font-medium flex items-center gap-1"><span>🔄</span> Substitutions <span className="text-[10px] text-muted-foreground font-normal">(internal)</span></div>
        <table className="w-full text-xs whitespace-nowrap">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="px-3 py-1.5 font-normal">Call-off</th>
              <th className="px-3 py-1.5 font-normal">Substituted</th>
              <th className="px-3 py-1.5 font-normal">Why</th>
              <th className="px-3 py-1.5 font-normal text-right">Ordered balance</th>
              <th className="px-3 py-1.5 font-normal text-right">Supplied</th>
              <th className="px-3 py-1.5 font-normal text-right">Over-supplied</th>
            </tr>
          </thead>
          <tbody>
            {substitutionSummary.map((s, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-1.5">{s.co}{s.date ? ` · ${s.date}` : ""}</td>
                <td className="px-3 py-1.5 text-[#A855F7] font-medium">{s.from} → {s.to}</td>
                <td className="px-3 py-1.5 text-muted-foreground whitespace-normal">{s.reason || "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{s.balance}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-medium">{s.supplied}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${s.over > 0 ? "text-[#EF4444] font-semibold" : "text-muted-foreground"}`}>{s.over > 0 ? `${s.over} over` : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <td className="px-3 py-1.5" colSpan={3}>Total</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{substitutionSummary.reduce((a, s) => a + s.balance, 0)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{substitutionSummary.reduce((a, s) => a + s.supplied, 0)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-[#EF4444]">{substitutionSummary.reduce((a, s) => a + s.over, 0)} over</td>
            </tr>
          </tfoot>
        </table>
      </div>
    )}

    <div className="rounded border overflow-x-auto">
      <div className="px-3 py-2 border-b text-xs font-medium">Balances per item</div>
      <table className="w-full text-xs whitespace-nowrap">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="px-3 py-1.5 font-normal">Item</th>
            <th className="px-3 py-1.5 font-normal text-right">PO Qty</th>
            {callOffs.map((co) => (
              <th key={co.id} className="px-3 py-1.5 font-normal text-right">CO{co.coSeq}</th>
            ))}
            <th className="px-3 py-1.5 font-normal text-right">Called off</th>
            <th className="px-3 py-1.5 font-normal text-right">Remaining PO</th>
            {deliveryNotes.map((dn) => (
              <th key={dn.no} className="px-3 py-1.5 font-normal text-right">DN{dn.no}</th>
            ))}
            <th className="px-3 py-1.5 font-normal text-right">Delivered</th>
            <th className="px-3 py-1.5 font-normal text-right">Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {matrix().map((r) => (
            <tr key={r.description} className="border-t">
              <td className="px-3 py-1.5">
                {r.description}
                {subLines(r.description).map((l, i) => (
                  <div key={i} className="text-[10px] text-[#A855F7] mt-0.5 whitespace-normal font-medium">{l}</div>
                ))}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{r.ordered}</td>
              {callOffs.map((co) => (
                <td key={co.id} className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.byCO[co.id] ?? "—"}</td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums font-medium">{r.calledOff}</td>
              <td className={`px-3 py-1.5 text-right tabular-nums ${r.oversupplied > 0 ? "text-[#EF4444] font-semibold" : r.remainingPO > 0 ? "text-[#3399FF]" : "text-muted-foreground"}`}>{r.oversupplied > 0 ? `${r.oversupplied} over` : (r.remainingPO || "—")}</td>
              {deliveryNotes.map((dn) => (
                <td key={dn.no} className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{dn.qtyByDescription[r.description] ?? "—"}</td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums">{r.delivered}</td>
              <td className={`px-3 py-1.5 text-right tabular-nums ${r.outstanding > 0 ? "text-[#FF9900] font-medium" : "text-muted-foreground"}`}>{r.outstanding || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}
