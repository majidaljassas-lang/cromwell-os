"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Zap, CheckCircle, AlertTriangle, Upload, Camera, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type Decimal = { toString(): string } | string | number | null;

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type BidItem = {
  id: string;
  description: string;
  qty: number;
  competitorPrice: number;
  utopiaPrice: number;
  bestOnlinePrice: number;
  ourCost: number;
  ourPrice: number;
};

type ExistingCompSheet = {
  id: string;
  name: string;
  versionNo: number;
  status: string;
  lines: Array<{
    id: string;
    benchmarkTotal: Decimal;
    ourCostTotal: Decimal;
    ourSaleTotal: Decimal;
    savingTotal: Decimal;
    marginTotal: Decimal;
    notes: string | null;
    ticketLine: {
      id: string;
      description: string;
      qty: Decimal;
      benchmarkUnit: Decimal;
      expectedCostUnit: Decimal;
      actualSaleUnit: Decimal;
    };
  }>;
};

function emptyItem(): BidItem {
  return {
    id: crypto.randomUUID(),
    description: "",
    qty: 1,
    competitorPrice: 0,
    utopiaPrice: 0,
    bestOnlinePrice: 0,
    ourCost: 0,
    ourPrice: 0,
  };
}

// ─── Parse enquiry text into items ──────────────────────────────────────────

function parseEnquiryText(text: string): BidItem[] {
  const items: BidItem[] = [];
  const lines = text.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    // Skip headers and totals
    if (/^(COMMUNITY|TOTAL|Item\s|#|---|===|Qty|Description)/i.test(line.trim())) continue;

    // OCR table format: "Product Name  9  132.51  1192.59  102.42  921.78  164.30  1478.70"
    // Extract all numbers, identify qty (small int) and unit prices
    const allNums = [...line.matchAll(/[\d,]+\.?\d*/g)].map(m => Number(m[0].replace(/,/g, "")));
    const textPart = line.replace(/[\d,.£$%]+/g, "").replace(/\s+/g, " ").trim();

    if (textPart.length > 3 && allNums.length >= 3) {
      // Find qty (first small number, typically < 100)
      const qtyIdx = allNums.findIndex(n => n > 0 && n < 100 && Number.isInteger(n));
      if (qtyIdx >= 0) {
        const qty = allNums[qtyIdx];
        const prices = allNums.filter((_, i) => i !== qtyIdx);
        // Unit prices are the smaller numbers (not line totals)
        const unitPrices = prices.filter(p => p < 1000).sort((a, b) => a - b);

        if (unitPrices.length >= 2) {
          items.push({
            id: crypto.randomUUID(),
            description: textPart,
            qty,
            utopiaPrice: unitPrices.length >= 3 ? unitPrices[2] : unitPrices[1],
            competitorPrice: unitPrices[0],
            bestOnlinePrice: unitPrices.length >= 3 ? unitPrices[unitPrices.length - 1] : 0,
            ourCost: 0,
            ourPrice: 0,
          });
          continue;
        }
      }
    }

    // Try pipe-delimited: "JTP Vos CS1000 | 9 | £132.51 | £102.42 | £164.30"
    const pipeMatch = line.split("|").map((s) => s.trim());
    if (pipeMatch.length >= 4) {
      const desc = pipeMatch[0];
      const qtyStr = pipeMatch[1];
      const prices = pipeMatch.slice(2).map((p) =>
        Number(p.replace(/[^0-9.]/g, "")) || 0
      );
      if (desc && qtyStr) {
        items.push({
          id: crypto.randomUUID(),
          description: desc,
          qty: Number(qtyStr.replace(/[^0-9]/g, "")) || 1,
          utopiaPrice: prices[0] || 0,
          competitorPrice: prices[1] || 0,
          bestOnlinePrice: prices[2] || 0,
          ourCost: 0,
          ourPrice: 0,
        });
        continue;
      }
    }

    // Try: "9 x Description @ £price"
    const qtyDescPrice = line.match(
      /(\d+)\s*x\s+(.+?)\s*@\s*[£$]?([\d,.]+)/i
    );
    if (qtyDescPrice) {
      items.push({
        id: crypto.randomUUID(),
        description: qtyDescPrice[2].trim(),
        qty: Number(qtyDescPrice[1]),
        competitorPrice: Number(qtyDescPrice[3].replace(/,/g, "")) || 0,
        utopiaPrice: 0,
        bestOnlinePrice: 0,
        ourCost: 0,
        ourPrice: 0,
      });
      continue;
    }

    // Try: "Description - Qty: 9 - Price: £102.42"
    const descQtyPrice = line.match(
      /(.+?)\s*-\s*(?:qty|quantity):\s*(\d+)\s*-\s*(?:price|cost):\s*[£$]?([\d,.]+)/i
    );
    if (descQtyPrice) {
      items.push({
        id: crypto.randomUUID(),
        description: descQtyPrice[1].trim(),
        qty: Number(descQtyPrice[2]),
        competitorPrice: Number(descQtyPrice[3].replace(/,/g, "")) || 0,
        utopiaPrice: 0,
        bestOnlinePrice: 0,
        ourCost: 0,
        ourPrice: 0,
      });
      continue;
    }

    // Fallback: just use the line as description
    if (line.trim().length > 5 && !/^(total|item|qty|---|===)/i.test(line.trim())) {
      // Extract any numbers that might be qty and price
      const nums = line.match(/[\d,.]+/g)?.map((n) => Number(n.replace(/,/g, ""))) || [];
      if (nums.length >= 2) {
        items.push({
          id: crypto.randomUUID(),
          description: line.replace(/[\d,.£$]+/g, "").replace(/\s+/g, " ").trim(),
          qty: nums[0] < 100 ? nums[0] : 1,
          competitorPrice: nums.length >= 2 ? nums[1] : 0,
          utopiaPrice: 0,
          bestOnlinePrice: 0,
          ourCost: 0,
          ourPrice: 0,
        });
      }
    }
  }

  return items;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CompetitiveBidPanel({
  ticketId,
}: {
  ticketId: string;
}) {
  const router = useRouter();
  const [existingBids, setExistingBids] = useState<ExistingCompSheet[]>([]);
  const [loadingBids, setLoadingBids] = useState(true);

  useEffect(() => {
    fetch(`/api/tickets/${ticketId}/competitive-bid`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setExistingBids(data))
      .catch(() => setExistingBids([]))
      .finally(() => setLoadingBids(false));
  }, [ticketId]);
  const [competitorName, setCompetitorName] = useState("");
  const [competitorLabel, setCompetitorLabel] = useState("Neville Lumb");
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [utopiaLabel, setUtopiaLabel] = useState("Utopia");
  const [bestOnlineLabel, setBestOnlineLabel] = useState("Best Online");
  const [items, setItems] = useState<BidItem[]>([emptyItem()]);
  const [enquiryText, setEnquiryText] = useState("");
  const [showEnquiryInput, setShowEnquiryInput] = useState(false);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Item management ────────────────────────────────────────────────────

  function updateItem(id: string, field: keyof BidItem, value: string | number) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  function parseFromEnquiry() {
    if (!enquiryText.trim()) return;
    const parsed = parseEnquiryText(enquiryText);
    if (parsed.length > 0) {
      setItems(parsed);
      setShowEnquiryInput(false);
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrProcessing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/ocr", { method: "POST", body: fd });
      if (res.ok) {
        const { text } = await res.json();
        setEnquiryText(text);
        // Auto-parse
        const parsed = parseEnquiryText(text);
        if (parsed.length > 0) {
          setItems(parsed);
          setShowEnquiryInput(false);
        } else {
          setShowEnquiryInput(true);
        }
      }
    } finally {
      setOcrProcessing(false);
    }
  }

  // ─── Computed values ────────────────────────────────────────────────────

  const summary = useMemo(() => {
    let totalCompetitor = 0;
    let totalUtopia = 0;
    let totalBestOnline = 0;
    let totalOurCost = 0;
    let totalOurPrice = 0;

    for (const item of items) {
      totalCompetitor += item.competitorPrice * item.qty;
      totalUtopia += item.utopiaPrice * item.qty;
      totalBestOnline += item.bestOnlinePrice * item.qty;
      totalOurCost += item.ourCost * item.qty;
      totalOurPrice += item.ourPrice * item.qty;
    }

    const totalMargin = totalOurPrice - totalOurCost;
    const marginPct = totalOurPrice > 0 ? (totalMargin / totalOurPrice) * 100 : 0;
    // Compare against the LOWEST competitor (the one we need to beat)
    const competitorTotals = [totalCompetitor, totalUtopia, totalBestOnline].filter(t => t > 0);
    const lowestCompetitor = competitorTotals.length > 0 ? Math.min(...competitorTotals) : 0;
    const undercut = lowestCompetitor - totalOurPrice;
    const undercutPct = lowestCompetitor > 0 ? (undercut / lowestCompetitor) * 100 : 0;

    return {
      totalCompetitor,
      totalUtopia,
      totalBestOnline,
      lowestCompetitor,
      totalOurCost,
      totalOurPrice,
      totalMargin,
      marginPct,
      undercut,
      undercutPct,
    };
  }, [items]);

  // ─── Submit ─────────────────────────────────────────────────────────────

  async function handleSubmit() {
    // Auto-detect which competitor we're bidding against (lowest total)
    const totals: Array<[string, number]> = [];
    if (summary.totalCompetitor > 0) totals.push([competitorLabel || "Competitor 1", summary.totalCompetitor]);
    if (summary.totalUtopia > 0) totals.push([utopiaLabel || "Competitor 2", summary.totalUtopia]);
    if (summary.totalBestOnline > 0) totals.push([bestOnlineLabel || "Competitor 3", summary.totalBestOnline]);
    totals.sort((a, b) => a[1] - b[1]);
    const bidAgainst = totals.length > 0 ? totals[0][0] : competitorLabel;

    if (!bidAgainst) {
      setError("At least one competitor price is required");
      return;
    }

    const validItems = items.filter((i) => i.description.trim());
    if (validItems.length === 0) {
      setError("At least one item with a description is required");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/tickets/${ticketId}/competitive-bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: validItems.map((i) => ({
            description: i.description,
            qty: i.qty,
            competitorPrice: i.competitorPrice,
            utopiaPrice: i.utopiaPrice || undefined,
            bestOnlinePrice: i.bestOnlinePrice || undefined,
            ourCost: i.ourCost || undefined,
            ourPrice: i.ourPrice || undefined,
          })),
          competitorName: bidAgainst,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create competitive bid");
      }

      setSubmitted(true);
      refreshBids();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Refresh bids helper ─────────────────────────────────────────────

  function refreshBids() {
    fetch(`/api/tickets/${ticketId}/competitive-bid`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setExistingBids(data))
      .catch(() => {});
  }

  // ─── Render existing bids ──────────────────────────────────────────────

  if (loadingBids) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-[#888888] text-sm">
          Loading competitive bids...
        </CardContent>
      </Card>
    );
  }

  async function handleGenerateEvaluation(compSheetId: string) {
    setGeneratingPdf(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/competitive-evaluation-pdf?compSheetId=${compSheetId}`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.path) {
          window.open(`/api/tickets/${ticketId}/competitive-evaluation-pdf?compSheetId=${compSheetId}`, "_blank");
        }
      }
    } finally {
      setGeneratingPdf(false);
    }
  }

  if (existingBids.length > 0 && !submitted) {
    return (
      <div className="space-y-4">
        {existingBids.map((bid) => {
          // Parse competitor pricing from notes
          const lines = bid.lines.map((line) => {
            let meta: {
              competitorName?: string;
              competitorUnitPrice?: number;
              utopiaUnitPrice?: number;
              bestOnlineUnitPrice?: number;
            } = {};
            try {
              if (line.notes) meta = JSON.parse(line.notes);
            } catch { /* ignore */ }

            const qty = Number(line.ticketLine.qty || 0);
            const competitorUnit = meta.competitorUnitPrice || 0;
            const utopiaUnit = meta.utopiaUnitPrice || 0;
            const bestOnlineUnit = meta.bestOnlineUnitPrice || 0;
            const ourCostUnit = Number(line.ticketLine.expectedCostUnit || 0);
            const ourSaleUnit = Number(line.ticketLine.actualSaleUnit || 0);
            const margin = ourSaleUnit > 0 && ourCostUnit > 0 ? (ourSaleUnit - ourCostUnit) * qty : 0;
            const undercut = competitorUnit > 0 && ourSaleUnit > 0 ? (competitorUnit - ourSaleUnit) * qty : 0;

            return {
              ...line,
              meta,
              qty,
              competitorUnit,
              utopiaUnit,
              bestOnlineUnit,
              ourCostUnit,
              ourSaleUnit,
              margin,
              undercut,
            };
          });

          // Extract competitor name from sheet name
          const competitorDisplay = bid.name.replace("Competitive Bid vs ", "");

          // Check if any line has utopia/bestOnline data
          const hasUtopia = lines.some(l => l.utopiaUnit > 0);
          const hasBestOnline = lines.some(l => l.bestOnlineUnit > 0);

          // Totals
          const totCompetitor = lines.reduce((s, l) => s + l.competitorUnit * l.qty, 0);
          const totOurCost = lines.reduce((s, l) => s + l.ourCostUnit * l.qty, 0);
          const totOurSale = lines.reduce((s, l) => s + l.ourSaleUnit * l.qty, 0);
          const totMargin = totOurSale - totOurCost;
          const totMarginPct = totOurSale > 0 ? (totMargin / totOurSale) * 100 : 0;
          const totSaving = totCompetitor - totOurSale;

          return (
            <ExistingBidCard
              key={bid.id}
              bid={bid}
              lines={lines}
              competitorDisplay={competitorDisplay}
              hasUtopia={hasUtopia}
              hasBestOnline={hasBestOnline}
              totCompetitor={totCompetitor}
              totOurCost={totOurCost}
              totOurSale={totOurSale}
              totMargin={totMargin}
              totMarginPct={totMarginPct}
              totSaving={totSaving}
              generatingPdf={generatingPdf}
              handleGenerateEvaluation={handleGenerateEvaluation}
              onSaved={() => router.refresh()}
              ticketId={ticketId}
            />
          );
        })}

        {/* Allow creating another bid */}
        <NewBidForm
          competitorName={competitorName}
          setCompetitorName={setCompetitorName}
          items={items}
          setItems={setItems}
          updateItem={updateItem}
          addItem={addItem}
          removeItem={removeItem}
          enquiryText={enquiryText}
          setEnquiryText={setEnquiryText}
          showEnquiryInput={showEnquiryInput}
          setShowEnquiryInput={setShowEnquiryInput}
          parseFromEnquiry={parseFromEnquiry}
          handleImageUpload={handleImageUpload}
          ocrProcessing={ocrProcessing}
          competitorLabel={competitorLabel}
          setCompetitorLabel={setCompetitorLabel}
          utopiaLabel={utopiaLabel}
          setUtopiaLabel={setUtopiaLabel}
          bestOnlineLabel={bestOnlineLabel}
          setBestOnlineLabel={setBestOnlineLabel}
          summary={summary}
          submitting={submitting}
          error={error}
          handleSubmit={handleSubmit}
          collapsed
        />
      </div>
    );
  }

  if (submitted) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <CheckCircle className="w-8 h-8 text-[#00CC66] mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">Competitive bid created</p>
          <p className="text-xs text-[#888888] mb-4">
            {items.filter((i) => i.description.trim()).length} line(s) added to the ticket with competitor benchmarks.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSubmitted(false);
              setItems([emptyItem()]);
              setCompetitorName("");
              refreshBids();
              router.refresh();
            }}
          >
            Create Another Bid
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <NewBidForm
      competitorName={competitorName}
      setCompetitorName={setCompetitorName}
      items={items}
      setItems={setItems}
      updateItem={updateItem}
      addItem={addItem}
      removeItem={removeItem}
      enquiryText={enquiryText}
      setEnquiryText={setEnquiryText}
      showEnquiryInput={showEnquiryInput}
      setShowEnquiryInput={setShowEnquiryInput}
      parseFromEnquiry={parseFromEnquiry}
      handleImageUpload={handleImageUpload}
      ocrProcessing={ocrProcessing}
      competitorLabel={competitorLabel}
      setCompetitorLabel={setCompetitorLabel}
      utopiaLabel={utopiaLabel}
      setUtopiaLabel={setUtopiaLabel}
      bestOnlineLabel={bestOnlineLabel}
      setBestOnlineLabel={setBestOnlineLabel}
      summary={summary}
      submitting={submitting}
      error={error}
      handleSubmit={handleSubmit}
    />
  );
}

// ─── New Bid Form (separated for reuse) ──────────────────────────────────────

function NewBidForm({
  competitorName,
  setCompetitorName,
  items,
  setItems,
  updateItem,
  addItem,
  removeItem,
  enquiryText,
  setEnquiryText,
  showEnquiryInput,
  setShowEnquiryInput,
  parseFromEnquiry,
  handleImageUpload,
  ocrProcessing,
  competitorLabel,
  setCompetitorLabel,
  utopiaLabel,
  setUtopiaLabel,
  bestOnlineLabel,
  setBestOnlineLabel,
  summary,
  submitting,
  error,
  handleSubmit,
  collapsed = false,
}: {
  competitorName: string;
  setCompetitorName: (v: string) => void;
  items: BidItem[];
  setItems: (v: BidItem[]) => void;
  updateItem: (id: string, field: keyof BidItem, value: string | number) => void;
  addItem: () => void;
  removeItem: (id: string) => void;
  enquiryText: string;
  setEnquiryText: (v: string) => void;
  showEnquiryInput: boolean;
  setShowEnquiryInput: (v: boolean) => void;
  parseFromEnquiry: () => void;
  handleImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  ocrProcessing: boolean;
  competitorLabel: string;
  setCompetitorLabel: (v: string) => void;
  utopiaLabel: string;
  setUtopiaLabel: (v: string) => void;
  bestOnlineLabel: string;
  setBestOnlineLabel: (v: string) => void;
  summary: {
    totalCompetitor: number;
    totalUtopia: number;
    totalBestOnline: number;
    lowestCompetitor: number;
    totalOurCost: number;
    totalOurPrice: number;
    totalMargin: number;
    marginPct: number;
    undercut: number;
    undercutPct: number;
  };
  submitting: boolean;
  error: string | null;
  handleSubmit: () => void;
  collapsed?: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsed);

  if (collapsed && !expanded) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setExpanded(true)}
        className="w-full"
      >
        <Plus className="w-3 h-3 mr-1" />
        New Competitive Bid
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold">New Competitive Bid</CardTitle>
          <div className="flex gap-2">
            <label className="cursor-pointer">
              <input type="file" accept=".png,.jpg,.jpeg,.pdf" className="hidden" onChange={handleImageUpload} disabled={ocrProcessing} />
              <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded ${ocrProcessing ? "bg-[#FF9900]/20 text-[#FF9900]" : "bg-[#3399FF]/10 text-[#3399FF] hover:bg-[#3399FF]/20"}`}>
                <Camera className="w-3 h-3" />
                {ocrProcessing ? "Reading image..." : "Upload Screenshot"}
              </span>
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowEnquiryInput(!showEnquiryInput)}
              className="text-[#FF9900] hover:text-[#FF9900]/80"
            >
              <Zap className="w-3 h-3 mr-1" />
              {showEnquiryInput ? "Hide" : "Paste Text"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Enquiry text parser */}
        {showEnquiryInput && (
          <div className="space-y-2 p-3 bg-[#111111] rounded-md border border-[#333333]">
            <Label className="text-[10px] uppercase tracking-wider text-[#888888]">
              Paste enquiry / pricing table
            </Label>
            <Textarea
              value={enquiryText}
              onChange={(e) => setEnquiryText(e.target.value)}
              placeholder={"Paste competitor pricing table here...\ne.g. JTP Vos CS1000 | 9 | £132.51 | £102.42 | £164.30"}
              className="bg-[#1A1A1A] border-[#333333] text-xs min-h-[100px] font-mono"
            />
            <Button size="sm" onClick={parseFromEnquiry} disabled={!enquiryText.trim()}>
              <Zap className="w-3 h-3 mr-1" />
              Parse Items
            </Button>
          </div>
        )}

        {/* Competitor names — click column headers to rename */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-[#888888]">
            Name the competitors (click column headers below to rename)
          </Label>
          <div className="flex gap-2">
            <Input
              value={competitorLabel}
              onChange={(e) => { setCompetitorLabel(e.target.value); setCompetitorName(e.target.value); }}
              placeholder="Competitor 1"
              className="bg-[#1A1A1A] border-[#333333] text-xs h-7 flex-1"
            />
            <Input
              value={utopiaLabel}
              onChange={(e) => setUtopiaLabel(e.target.value)}
              placeholder="Competitor 2"
              className="bg-[#1A1A1A] border-[#333333] text-xs h-7 flex-1"
            />
            <Input
              value={bestOnlineLabel}
              onChange={(e) => setBestOnlineLabel(e.target.value)}
              placeholder="Competitor 3 / Best Online"
              className="bg-[#1A1A1A] border-[#333333] text-xs h-7 flex-1"
            />
          </div>
        </div>

        {/* Items table */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-[#333333]">
                <TableHead className="text-[10px] uppercase tracking-wider text-[#888888] min-w-[200px]">Description</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-[#888888] text-right w-[60px]">Qty</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-[#888888] text-right w-[90px]">{competitorLabel || "Competitor 1"}</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-[#888888] text-right w-[90px]">{utopiaLabel || "Competitor 2"}</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-[#888888] text-right w-[90px]">{bestOnlineLabel || "Competitor 3"}</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-[#888888] text-right w-[90px]">
                  <span className="text-[#FF9900]">Your Cost</span>
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-[#888888] text-right w-[90px]">
                  <span className="text-[#FF9900]">Your Price</span>
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-[#888888] text-right w-[80px]">Margin</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-[#888888] text-right w-[80px]">Undercut</TableHead>
                <TableHead className="w-[30px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const costTotal = item.ourCost * item.qty;
                const saleTotal = item.ourPrice * item.qty;
                const margin = saleTotal - costTotal;
                const undercut = item.competitorPrice > 0 && item.ourPrice > 0
                  ? (item.competitorPrice - item.ourPrice) * item.qty
                  : 0;

                return (
                  <TableRow key={item.id} className="border-[#333333] hover:bg-[#1E1E1E]">
                    <TableCell className="p-1">
                      <Input
                        value={item.description}
                        onChange={(e) => updateItem(item.id, "description", e.target.value)}
                        placeholder="Item description"
                        className="bg-transparent border-transparent hover:border-[#444] focus:border-[#FF6600] focus:bg-[#222222] text-xs h-7 px-1.5"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number"
                        value={item.qty || ""}
                        onChange={(e) => updateItem(item.id, "qty", Number(e.target.value) || 0)}
                        className="bg-transparent border-transparent hover:border-[#444] focus:border-[#FF6600] focus:bg-[#222222] text-xs h-7 w-14 text-right tabular-nums px-1.5"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number"
                        step="0.01"
                        value={item.competitorPrice || ""}
                        onChange={(e) => updateItem(item.id, "competitorPrice", Number(e.target.value) || 0)}
                        placeholder="0.00"
                        className="bg-transparent border-transparent hover:border-[#444] focus:border-[#FF6600] focus:bg-[#222222] text-xs h-7 w-20 text-right tabular-nums px-1.5"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number"
                        step="0.01"
                        value={item.utopiaPrice || ""}
                        onChange={(e) => updateItem(item.id, "utopiaPrice", Number(e.target.value) || 0)}
                        placeholder="0.00"
                        className="bg-transparent border-transparent hover:border-[#444] focus:border-[#FF6600] focus:bg-[#222222] text-xs h-7 w-20 text-right tabular-nums px-1.5 text-[#888888]"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number"
                        step="0.01"
                        value={item.bestOnlinePrice || ""}
                        onChange={(e) => updateItem(item.id, "bestOnlinePrice", Number(e.target.value) || 0)}
                        placeholder="0.00"
                        className="bg-transparent border-transparent hover:border-[#444] focus:border-[#FF6600] focus:bg-[#222222] text-xs h-7 w-20 text-right tabular-nums px-1.5 text-[#888888]"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number"
                        step="0.01"
                        value={item.ourCost || ""}
                        onChange={(e) => updateItem(item.id, "ourCost", Number(e.target.value) || 0)}
                        placeholder="0.00"
                        className="bg-transparent border-transparent hover:border-[#444] focus:border-[#FF9900] focus:bg-[#222222] text-xs h-7 w-20 text-right tabular-nums px-1.5 text-[#FF9900]"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number"
                        step="0.01"
                        value={item.ourPrice || ""}
                        onChange={(e) => updateItem(item.id, "ourPrice", Number(e.target.value) || 0)}
                        placeholder="0.00"
                        className="bg-transparent border-transparent hover:border-[#444] focus:border-[#FF9900] focus:bg-[#222222] text-xs h-7 w-20 text-right tabular-nums px-1.5 font-medium text-[#FF9900]"
                      />
                    </TableCell>
                    <TableCell className="p-1 text-right">
                      {item.ourCost > 0 && item.ourPrice > 0 ? (
                        <span className={`text-xs tabular-nums ${margin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}`}>
                          {fmtMoney(margin)}
                        </span>
                      ) : (
                        <span className="text-xs text-[#555555]">{"\u2014"}</span>
                      )}
                    </TableCell>
                    <TableCell className="p-1 text-right">
                      {item.competitorPrice > 0 && item.ourPrice > 0 ? (
                        <span className={`text-xs tabular-nums ${undercut > 0 ? "text-[#00CC66]" : "text-[#FF3333]"}`}>
                          {fmtMoney(undercut)}
                        </span>
                      ) : (
                        <span className="text-xs text-[#555555]">{"\u2014"}</span>
                      )}
                    </TableCell>
                    <TableCell className="p-1">
                      {items.length > 1 && (
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-[#555555] hover:text-[#FF3333] transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Add item button */}
        <Button size="sm" variant="ghost" onClick={addItem} className="text-xs text-[#888888]">
          <Plus className="w-3 h-3 mr-1" />
          Add Item
        </Button>

        {/* Summary row */}
        {(summary.totalCompetitor > 0 || summary.totalOurPrice > 0) && (
          <div className="p-3 bg-[#111111] rounded-md border border-[#333333] space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-[#888888] font-bold">Summary</div>
            <div className="grid grid-cols-5 gap-3 text-xs">
              <div>
                <div className="text-[10px] text-[#888888]">Lowest Competitor</div>
                <div className="tabular-nums text-[#FF9900] font-medium">
                  {summary.lowestCompetitor > 0 ? `\u00A3${fmtMoney(summary.lowestCompetitor)}` : "\u2014"}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#888888]">Our Cost</div>
                <div className="tabular-nums">
                  {summary.totalOurCost > 0 ? `\u00A3${fmtMoney(summary.totalOurCost)}` : "\u2014"}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#888888]">Our Price</div>
                <div className="tabular-nums font-medium">
                  {summary.totalOurPrice > 0 ? `\u00A3${fmtMoney(summary.totalOurPrice)}` : "\u2014"}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#888888]">Margin</div>
                <div className={`tabular-nums ${summary.totalMargin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}`}>
                  {summary.totalOurPrice > 0
                    ? `\u00A3${fmtMoney(summary.totalMargin)} (${summary.marginPct.toFixed(1)}%)`
                    : "\u2014"}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#888888]">Undercut</div>
                <div className={`tabular-nums ${summary.undercut > 0 ? "text-[#00CC66]" : summary.undercut < 0 ? "text-[#FF3333]" : ""}`}>
                  {summary.totalOurPrice > 0 && summary.totalCompetitor > 0
                    ? `\u00A3${fmtMoney(summary.undercut)} (${summary.undercutPct.toFixed(1)}%)`
                    : "\u2014"}
                </div>
              </div>
            </div>
            {summary.undercut > 0 && summary.totalMargin > 0 && (
              <div className="flex items-center gap-1 text-[#00CC66] text-xs mt-1">
                <CheckCircle className="w-3 h-3" />
                Beating competitor by {fmtMoney(summary.undercut)} while maintaining {summary.marginPct.toFixed(1)}% margin
              </div>
            )}
            {summary.undercut < 0 && (
              <div className="flex items-center gap-1 text-[#FF3333] text-xs mt-1">
                <AlertTriangle className="w-3 h-3" />
                Your price is {fmtMoney(Math.abs(summary.undercut))} above the competitor
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-xs text-[#FF3333] bg-[#FF3333]/10 px-3 py-2 rounded">
            {error}
          </div>
        )}

        {/* Submit */}
        <div className="flex justify-end gap-2">
          {collapsed && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(false)}
            >
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !competitorName.trim() || items.every((i) => !i.description.trim())}
            className="bg-[#FF9900] hover:bg-[#FF9900]/90 text-black font-medium"
          >
            {submitting ? "Creating..." : "Accept & Create Lines"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Existing Bid Card — inline editable ────────────────────────────────────

function ExistingBidCard({
  bid, lines, competitorDisplay, hasUtopia, hasBestOnline,
  totCompetitor, totOurCost, totOurSale, totMargin, totMarginPct, totSaving,
  generatingPdf, handleGenerateEvaluation, onSaved, ticketId,
}: {
  bid: ExistingCompSheet;
  lines: Array<any>;
  competitorDisplay: string;
  hasUtopia: boolean;
  hasBestOnline: boolean;
  totCompetitor: number;
  totOurCost: number;
  totOurSale: number;
  totMargin: number;
  totMarginPct: number;
  totSaving: number;
  generatingPdf: boolean;
  handleGenerateEvaluation: (id: string) => void;
  onSaved: () => void;
  ticketId: string;
}) {
  const thCls = "text-[10px] uppercase tracking-wider text-[#888888] text-right";

  // Local state for live editing — initialize from server data
  const [localCosts, setLocalCosts] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const l of lines) m[l.ticketLine.id] = l.ourCostUnit;
    return m;
  });
  const [localPrices, setLocalPrices] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const l of lines) m[l.ticketLine.id] = l.ourSaleUnit;
    return m;
  });

  function getCost(id: string) { return localCosts[id] || 0; }
  function getPrice(id: string) { return localPrices[id] || 0; }

  async function saveCost(lineId: string, value: number) {
    setLocalCosts(prev => ({ ...prev, [lineId]: value }));
    await fetch(`/api/ticket-lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedCostUnit: value || undefined }),
    });
  }

  async function savePrice(lineId: string, value: number) {
    setLocalPrices(prev => ({ ...prev, [lineId]: value }));
    await fetch(`/api/ticket-lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actualSaleUnit: value || undefined }),
    });
  }

  // Live totals from local state
  const liveTotCost = lines.reduce((s, l) => s + getCost(l.ticketLine.id) * l.qty, 0);
  const liveTotSale = lines.reduce((s, l) => s + getPrice(l.ticketLine.id) * l.qty, 0);
  const liveTotMargin = liveTotSale - liveTotCost;
  const liveTotMarginPct = liveTotSale > 0 ? (liveTotMargin / liveTotSale) * 100 : 0;
  const liveTotSaving = totCompetitor - liveTotSale;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold">{bid.name}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">v{bid.versionNo}</Badge>
            <Badge variant="outline">{bid.status}</Badge>
            <Button size="sm" className="bg-[#3399FF] text-white hover:bg-[#2277DD] h-7 text-xs"
              onClick={() => handleGenerateEvaluation(bid.id)} disabled={generatingPdf}>
              <FileDown className="w-3 h-3 mr-1" />
              {generatingPdf ? "Generating..." : "Download Evaluation PDF"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary cards — live updating */}
        <div className="grid grid-cols-5 gap-3">
          <div className="border border-[#333333] bg-[#111] p-2 text-center">
            <p className="text-[9px] text-[#888888] uppercase">{competitorDisplay} Total</p>
            <p className="text-sm font-semibold tabular-nums text-[#FF9900]">£{fmtMoney(totCompetitor)}</p>
          </div>
          <div className="border border-[#333333] bg-[#111] p-2 text-center">
            <p className="text-[9px] text-[#888888] uppercase">Our Cost</p>
            <p className="text-sm font-semibold tabular-nums">£{fmtMoney(liveTotCost)}</p>
          </div>
          <div className="border border-[#333333] bg-[#111] p-2 text-center">
            <p className="text-[9px] text-[#888888] uppercase">Our Price</p>
            <p className="text-sm font-semibold tabular-nums">£{fmtMoney(liveTotSale)}</p>
          </div>
          <div className="border border-[#333333] bg-[#111] p-2 text-center">
            <p className="text-[9px] text-[#888888] uppercase">Margin ({liveTotMarginPct.toFixed(1)}%)</p>
            <p className={`text-sm font-semibold tabular-nums ${liveTotMargin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}`}>£{fmtMoney(liveTotMargin)}</p>
          </div>
          <div className="border border-[#333333] bg-[#111] p-2 text-center">
            <p className="text-[9px] text-[#888888] uppercase">Saving vs {competitorDisplay}</p>
            <p className={`text-sm font-semibold tabular-nums ${liveTotSaving > 0 ? "text-[#00CC66]" : liveTotSaving < 0 ? "text-[#FF3333]" : ""}`}>£{fmtMoney(liveTotSaving)}</p>
          </div>
        </div>

        {/* Lines table */}
        <div>
          <Table>
            <TableHeader>
              <TableRow className="border-[#333333]">
                <TableHead className="text-[10px] uppercase tracking-wider text-[#888888] w-[25%]">Item</TableHead>
                <TableHead className={`${thCls} w-10`}>Qty</TableHead>
                <TableHead className={`${thCls} w-20`}>{competitorDisplay}</TableHead>
                {hasUtopia && <TableHead className={`${thCls} w-20`}>Competitor 2</TableHead>}
                {hasBestOnline && <TableHead className={`${thCls} w-20`}>Competitor 3</TableHead>}
                <TableHead className={`${thCls} w-24`}>Our Cost</TableHead>
                <TableHead className={`${thCls} w-24`}>Our Price</TableHead>
                <TableHead className={`${thCls} w-20`}>Margin</TableHead>
                <TableHead className={`${thCls} w-16`}>Margin %</TableHead>
                <TableHead className={`${thCls} w-20`}>Saving</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const cost = getCost(line.ticketLine.id);
                const price = getPrice(line.ticketLine.id);
                const margin = price > 0 && cost > 0 ? (price - cost) * line.qty : 0;
                const marginPct = price > 0 && cost > 0 ? ((price - cost) / price) * 100 : 0;
                const saving = line.competitorUnit > 0 && price > 0 ? line.competitorUnit - price : 0;

                return (
                  <TableRow key={line.id} className="border-[#333333] hover:bg-[#1E1E1E]">
                    <TableCell className="text-xs font-medium max-w-[200px] truncate">
                      {line.ticketLine.description}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{line.qty}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums text-[#FF9900] font-medium">
                      {line.competitorUnit > 0 ? `£${fmtMoney(line.competitorUnit)}` : "—"}
                    </TableCell>
                    {hasUtopia && (
                      <TableCell className="text-xs text-right tabular-nums text-[#888888]">
                        {line.utopiaUnit > 0 ? `£${fmtMoney(line.utopiaUnit)}` : "—"}
                      </TableCell>
                    )}
                    {hasBestOnline && (
                      <TableCell className="text-xs text-right tabular-nums text-[#888888]">
                        {line.bestOnlineUnit > 0 ? `£${fmtMoney(line.bestOnlineUnit)}` : "—"}
                      </TableCell>
                    )}
                    <TableCell className="p-0">
                      <input
                        type="number" step="0.01"
                        className="w-full bg-transparent text-right text-xs tabular-nums px-2 py-1.5 border-0 focus:outline-none focus:bg-[#222]"
                        defaultValue={cost > 0 ? cost : ""}
                        placeholder="—"
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const v = Number(e.target.value || 0);
                          saveCost(line.ticketLine.id, v);
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />
                    </TableCell>
                    <TableCell className="p-0">
                      <input
                        type="number" step="0.01"
                        className="w-full bg-transparent text-right text-xs tabular-nums px-2 py-1.5 border-0 focus:outline-none focus:bg-[#222] font-medium"
                        defaultValue={price > 0 ? price : ""}
                        placeholder="—"
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const v = Number(e.target.value || 0);
                          savePrice(line.ticketLine.id, v);
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />
                    </TableCell>
                    <TableCell className={`text-xs text-right tabular-nums ${margin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}`}>
                      {price > 0 && cost > 0 ? `£${fmtMoney(margin)}` : "—"}
                    </TableCell>
                    <TableCell className={`text-xs text-right tabular-nums ${marginPct >= 20 ? "text-[#00CC66]" : marginPct >= 10 ? "text-[#FF9900]" : "text-[#FF3333]"}`}>
                      {price > 0 && cost > 0 ? `${marginPct.toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell className={`text-xs text-right tabular-nums font-medium ${saving > 0 ? "text-[#00CC66]" : saving < 0 ? "text-[#FF3333]" : ""}`}>
                      {price > 0 && line.competitorUnit > 0 ? `£${fmtMoney(saving)}` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
