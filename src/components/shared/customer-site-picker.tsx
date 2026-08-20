"use client";

import { useCallback, useEffect, useState } from "react";

type PickResult = { id: string; label: string; sublabel?: string };

interface Props {
  /** Headline shown at the top, e.g. "Reassign customer & site" or a tag label */
  headline: string;
  /** Subheadline, e.g. "Allocate before creating" */
  subheadline?: string;
  /** Pre-fill customer */
  initialCustomer?: PickResult | null;
  /** Pre-fill site */
  initialSite?: PickResult | null;
  /** Whether the confirm button is disabled because work is in flight */
  busy?: boolean;
  /** Error to surface above the buttons */
  error?: string | null;
  /** "Save" / "Create Ticket" — caller picks */
  confirmLabel: string;
  /** Site is required (e.g. ticket already past PRICING) */
  siteRequired?: boolean;
  onCancel: () => void;
  onConfirm: (customerId: string, siteId: string | null) => void;
}

export function CustomerSitePicker({
  headline,
  subheadline,
  initialCustomer,
  initialSite,
  busy = false,
  error,
  confirmLabel,
  siteRequired = false,
  onCancel,
  onConfirm,
}: Props) {
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<PickResult[]>([]);
  const [customer, setCustomer] = useState<PickResult | null>(initialCustomer ?? null);
  const [siteSearch, setSiteSearch] = useState("");
  const [siteResults, setSiteResults] = useState<PickResult[]>([]);
  const [site, setSite] = useState<PickResult | null>(initialSite ?? null);

  const search = useCallback(async (kind: "customer" | "site", q: string) => {
    const url = new URL(kind === "customer" ? "/api/customers" : "/api/sites", window.location.origin);
    if (q.trim()) url.searchParams.set("search", q.trim());
    try {
      const r = await fetch(url.toString());
      if (!r.ok) return [] as PickResult[];
      const d = await r.json();
      const list: any[] = Array.isArray(d) ? d : d.customers ?? d.sites ?? d.items ?? [];
      return list.slice(0, 12).map((x) => ({
        id: x.id,
        label: x.name ?? x.siteName ?? x.label ?? "—",
        sublabel: x.legalName ?? x.siteCode ?? x.postcode ?? undefined,
      })) as PickResult[];
    } catch {
      return [] as PickResult[];
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => setCustomerResults(await search("customer", customerSearch)), 200);
    return () => clearTimeout(t);
  }, [customerSearch, search]);

  useEffect(() => {
    const t = setTimeout(async () => setSiteResults(await search("site", siteSearch)), 200);
    return () => clearTimeout(t);
  }, [siteSearch, search]);

  const canConfirm = !!customer && (!siteRequired || !!site) && !busy;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="w-full max-w-lg bg-[#1A1A1A] border border-[#333] p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          {subheadline && (
            <div className="text-[10px] uppercase tracking-widest text-[#888]">{subheadline}</div>
          )}
          <div className="text-sm font-bold text-[#FF6600]">{headline}</div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest text-[#888]">Customer *</div>
          {customer ? (
            <div className="flex items-center justify-between border border-[#444] bg-[#0A0A0A] px-2 py-1.5">
              <div>
                <div className="text-[12px]">{customer.label}</div>
                {customer.sublabel && <div className="text-[10px] text-[#888]">{customer.sublabel}</div>}
              </div>
              <button onClick={() => setCustomer(null)} className="text-[10px] text-[#888] hover:text-[#FFF]">change</button>
            </div>
          ) : (
            <>
              <input
                autoFocus
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search customers…"
                className="w-full text-[12px] bg-[#0A0A0A] border border-[#333] px-2 py-1.5 outline-none focus:border-[#FF6600]"
              />
              <div className="max-h-44 overflow-y-auto border border-[#222] divide-y divide-[#222]">
                {customerResults.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCustomer(c)}
                    className="w-full text-left px-2 py-1.5 hover:bg-[#222] text-[12px]"
                  >
                    {c.label}
                    {c.sublabel && <span className="text-[10px] text-[#888] ml-2">{c.sublabel}</span>}
                  </button>
                ))}
                {customerResults.length === 0 && (
                  <div className="px-2 py-2 text-[11px] text-[#666]">No matches</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest text-[#888]">
            Site {siteRequired ? "*" : "(optional)"}
          </div>
          {site ? (
            <div className="flex items-center justify-between border border-[#444] bg-[#0A0A0A] px-2 py-1.5">
              <div>
                <div className="text-[12px]">{site.label}</div>
                {site.sublabel && <div className="text-[10px] text-[#888]">{site.sublabel}</div>}
              </div>
              <button onClick={() => setSite(null)} className="text-[10px] text-[#888] hover:text-[#FFF]">change</button>
            </div>
          ) : (
            <>
              <input
                value={siteSearch}
                onChange={(e) => setSiteSearch(e.target.value)}
                placeholder="Search sites…"
                className="w-full text-[12px] bg-[#0A0A0A] border border-[#333] px-2 py-1.5 outline-none focus:border-[#FF6600]"
              />
              <div className="max-h-44 overflow-y-auto border border-[#222] divide-y divide-[#222]">
                {siteResults.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSite(s)}
                    className="w-full text-left px-2 py-1.5 hover:bg-[#222] text-[12px]"
                  >
                    {s.label}
                    {s.sublabel && <span className="text-[10px] text-[#888] ml-2">{s.sublabel}</span>}
                  </button>
                ))}
                {siteResults.length === 0 && (
                  <div className="px-2 py-2 text-[11px] text-[#666]">No matches</div>
                )}
              </div>
            </>
          )}
        </div>

        {error && <div className="text-[11px] text-[#FF6666]">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-[11px] px-3 py-1.5 border border-[#333] text-[#888] hover:text-[#FFF]"
          >
            Cancel
          </button>
          <button
            onClick={() => customer && onConfirm(customer.id, site?.id ?? null)}
            disabled={!canConfirm}
            className="text-[11px] px-3 py-1.5 bg-[#FF6600] text-black font-bold disabled:opacity-40"
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
