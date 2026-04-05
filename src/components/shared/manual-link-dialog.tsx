"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Link2, Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type LinkType = "CUSTOMER" | "SITE" | "ORDER_THREAD" | "INVOICE_LINE" | "BILL_LINE";

type SearchResult = {
  id: string;
  label: string;
  sublabel?: string;
  badges?: Array<{ text: string; color: string }>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkType: LinkType;
  sourceId: string;
  rawText?: string;
  onLinked?: () => void;
};

const LINK_TYPE_CONFIG: Record<LinkType, { title: string; searchPlaceholder: string; endpoint: string }> = {
  CUSTOMER: { title: "Link to Customer", searchPlaceholder: "Search customers...", endpoint: "/api/customers" },
  SITE: { title: "Link to Site", searchPlaceholder: "Search sites...", endpoint: "/api/sites" },
  ORDER_THREAD: { title: "Link to Order Thread", searchPlaceholder: "Search order threads...", endpoint: "/api/backlog/cases" },
  INVOICE_LINE: { title: "Link to Invoice Line", searchPlaceholder: "Search invoices...", endpoint: "/api/reconciliation/invoices" },
  BILL_LINE: { title: "Link to Bill Line", searchPlaceholder: "Search supplier bills...", endpoint: "/api/supplier-bills" },
};

export function ManualLinkDialog({ open, onOpenChange, linkType, sourceId, rawText, onLinked }: Props) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);

  const config = LINK_TYPE_CONFIG[linkType];

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() && linkType !== "ORDER_THREAD") {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const url = new URL(config.endpoint, window.location.origin);
      if (q.trim()) url.searchParams.set("search", q.trim());

      const res = await fetch(url.toString());
      if (!res.ok) { setResults([]); setLoading(false); return; }
      const data = await res.json();

      // Normalize response to SearchResult[]
      const items: SearchResult[] = normalizeResults(data, linkType);
      setResults(items);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, [config.endpoint, linkType]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => doSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search, open, doSearch]);

  // Load initial results on open
  useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedId(null);
      setNotes("");
      setLinked(false);
      doSearch("");
    }
  }, [open, doSearch]);

  async function handleLink() {
    if (!selectedId) return;
    setLinking(true);
    try {
      const res = await fetch("/api/manual-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkType,
          sourceId,
          targetId: selectedId,
          rawText,
          linkedBy: "USER",
          notes: notes || undefined,
        }),
      });
      if (res.ok) {
        setLinked(true);
        setTimeout(() => {
          onOpenChange(false);
          onLinked?.();
        }, 800);
      }
    } catch { /* ignore */ }
    setLinking(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1A1A1A] border-[#333333] text-[#E0E0E0] max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[#FF6600] text-sm tracking-widest uppercase flex items-center gap-2">
            <Link2 className="size-4" /> {config.title}
          </DialogTitle>
        </DialogHeader>

        {rawText && (
          <div className="bg-[#222222] border border-[#333333] px-3 py-2 text-xs">
            <span className="text-[9px] text-[#888888] uppercase tracking-widest">RAW TEXT: </span>
            <span className="text-[#E0E0E0] bb-mono">{rawText}</span>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#666666]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={config.searchPlaceholder}
            className="pl-9 h-9 text-xs bg-[#222222] border-[#333333]"
            autoFocus
          />
        </div>

        {/* Results */}
        <div className="max-h-60 overflow-y-auto border border-[#333333] bg-[#0D0D0D]">
          {loading && (
            <div className="p-4 text-center text-[#888888] text-xs flex items-center justify-center gap-2">
              <Loader2 className="size-3.5 animate-spin" /> Searching...
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="p-4 text-center text-[#666666] text-xs">
              {search ? "No results found." : "Type to search..."}
            </div>
          )}
          {!loading && results.map((r) => (
            <div
              key={r.id}
              onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
              className={`px-3 py-2 cursor-pointer border-b border-[#222222] flex items-center justify-between ${
                r.id === selectedId ? "bg-[#FF6600]/10 border-l-2 border-l-[#FF6600]" : "hover:bg-[#1A1A1A]"
              }`}
            >
              <div>
                <div className="text-xs text-[#E0E0E0] font-medium">{r.label}</div>
                {r.sublabel && <div className="text-[9px] text-[#888888]">{r.sublabel}</div>}
              </div>
              <div className="flex items-center gap-1">
                {r.badges?.map((b, i) => (
                  <Badge key={i} className={`text-[7px] px-1 py-0 ${b.color}`}>{b.text}</Badge>
                ))}
                {r.id === selectedId && <Check className="size-4 text-[#FF6600]" />}
              </div>
            </div>
          ))}
        </div>

        {/* Notes */}
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)..."
          className="h-8 text-xs bg-[#222222] border-[#333333]"
        />

        <DialogFooter>
          {linked ? (
            <div className="flex items-center gap-2 text-[#00CC66] text-xs">
              <Check className="size-4" /> Linked successfully
            </div>
          ) : (
            <Button
              onClick={handleLink}
              disabled={!selectedId || linking}
              className="bg-[#FF6600] text-black hover:bg-[#FF9900]"
            >
              <Link2 className="size-4 mr-1" />
              {linking ? "Linking..." : "Confirm Link"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function normalizeResults(data: unknown, linkType: LinkType): SearchResult[] {
  const arr = Array.isArray(data) ? data : [];
  switch (linkType) {
    case "CUSTOMER":
      return arr.map((c: { id: string; name: string; legalName?: string; isCashCustomer?: boolean }) => ({
        id: c.id,
        label: c.name,
        sublabel: c.legalName || undefined,
        badges: c.isCashCustomer ? [{ text: "CASH", color: "text-[#00CC66] bg-[#00CC66]/10" }] : [],
      }));
    case "SITE":
      return arr.map((s: { id: string; siteName: string; city?: string; postcode?: string; siteCode?: string }) => ({
        id: s.id,
        label: s.siteName,
        sublabel: [s.city, s.postcode, s.siteCode].filter(Boolean).join(" · ") || undefined,
      }));
    case "ORDER_THREAD":
      return arr.map((t: { id: string; title?: string; label?: string; status?: string }) => ({
        id: t.id,
        label: t.title || t.label || t.id,
        badges: t.status ? [{ text: t.status, color: "text-[#888888] bg-[#333333]" }] : [],
      }));
    case "INVOICE_LINE":
      return arr.map((inv: { id: string; invoiceNumber?: string; supplierName?: string; totalAmount?: number }) => ({
        id: inv.id,
        label: inv.invoiceNumber || inv.id,
        sublabel: inv.supplierName || undefined,
        badges: inv.totalAmount != null ? [{ text: `£${Number(inv.totalAmount).toFixed(2)}`, color: "text-[#E0E0E0] bg-[#333333]" }] : [],
      }));
    case "BILL_LINE":
      return arr.map((b: { id: string; billNumber?: string; supplierName?: string; totalExVat?: number }) => ({
        id: b.id,
        label: b.billNumber || b.id,
        sublabel: b.supplierName || undefined,
        badges: b.totalExVat != null ? [{ text: `£${Number(b.totalExVat).toFixed(2)}`, color: "text-[#E0E0E0] bg-[#333333]" }] : [],
      }));
    default:
      return [];
  }
}
