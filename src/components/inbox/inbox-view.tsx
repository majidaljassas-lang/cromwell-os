"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  MessageSquare,
  FileText,
  Plus,
  Ticket,
  Link2,
  XCircle,
  RefreshCw,
  User,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

// ── Types ──────────────────────────────────────────────────────────────────

type UnifiedItem = {
  id: string;
  itemType: "INGESTION" | "WORK_ITEM";
  sourceType: string;
  subject: string;
  rawText: string | null;
  suggestedSiteName: string | null;
  suggestedCustomerName: string | null;
  classification: string | null;
  confidenceScore: number | null;
  receivedAt: string;
  status: string;
  customerId: string | null;
  siteId: string | null;
  enquiryId: string | null;
};

type Summary = {
  total: number;
  email: number;
  whatsapp: number;
  manual: number;
  needsTriage: number;
};

type CustomerOption = { id: string; name: string; isBillingEntity: boolean };
type SiteOption = { id: string; siteName: string };
type TicketOption = {
  id: string;
  ticketNo: number;
  title: string;
  payingCustomerId?: string;
  siteId?: string | null;
};
type CommercialLink = {
  id: string;
  customerId: string;
  siteId: string;
  site: { id: string; siteName: string };
};

// ── Helpers ────────────────────────────────────────────────────────────────

function sourceIcon(sourceType: string) {
  switch (sourceType) {
    case "EMAIL":
    case "OUTLOOK":
      return <Mail className="h-3.5 w-3.5" />;
    case "WHATSAPP":
      return <MessageSquare className="h-3.5 w-3.5" />;
    case "PDF_UPLOAD":
    case "IMAGE_UPLOAD":
      return <FileText className="h-3.5 w-3.5" />;
    case "MANUAL":
      return <User className="h-3.5 w-3.5" />;
    default:
      return <Mail className="h-3.5 w-3.5" />;
  }
}

function sourceBadge(sourceType: string) {
  const label =
    sourceType === "OUTLOOK" ? "EMAIL" : sourceType.replace("_", " ");
  const variant =
    sourceType === "WHATSAPP"
      ? "default"
      : sourceType === "MANUAL"
        ? "secondary"
        : "outline";
  return (
    <Badge variant={variant as "default" | "secondary" | "outline"}>
      <span className="flex items-center gap-1">
        {sourceIcon(sourceType)}
        {label}
      </span>
    </Badge>
  );
}

function classificationBadge(classification: string | null) {
  if (!classification) return <span className="text-[#555555]">--</span>;
  const colors: Record<string, string> = {
    DIRECT_ORDER: "bg-[#00CC66]/20 text-[#00CC66] border-[#00CC66]/30",
    ORDER: "bg-[#00CC66]/20 text-[#00CC66] border-[#00CC66]/30",
    APPROVAL: "bg-[#3399FF]/20 text-[#3399FF] border-[#3399FF]/30",
    DELIVERY_UPDATE: "bg-[#FF9900]/20 text-[#FF9900] border-[#FF9900]/30",
    QUOTE_REQUEST: "bg-[#CC66FF]/20 text-[#CC66FF] border-[#CC66FF]/30",
    PRICING_FIRST: "bg-[#CC66FF]/20 text-[#CC66FF] border-[#CC66FF]/30",
    FOLLOW_UP: "bg-[#FFCC00]/20 text-[#FFCC00] border-[#FFCC00]/30",
    DISPUTE: "bg-[#FF3333]/20 text-[#FF3333] border-[#FF3333]/30",
  };
  const cls = colors[classification] || "bg-[#333333] text-[#999999] border-[#444444]";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border ${cls}`}
    >
      {classification.replace(/_/g, " ")}
    </span>
  );
}

function confidenceDot(score: number | null) {
  if (score === null) return <span className="text-[#555555]">--</span>;
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "#00CC66" : pct >= 50 ? "#FF9900" : "#FF3333";
  return (
    <span className="flex items-center gap-1 text-[11px]">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      {pct}%
    </span>
  );
}

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const TICKET_MODES = [
  "DIRECT_ORDER",
  "PRICING_FIRST",
  "SPEC_DRIVEN",
  "COMPETITIVE_BID",
  "RECOVERY",
  "CASH_SALE",
  "LABOUR_ONLY",
  "PROJECT_WORK",
  "NON_SITE",
];

// ── Component ──────────────────────────────────────────────────────────────

export function InboxView({
  customers,
  sites,
  tickets,
  commercialLinks,
}: {
  customers: CustomerOption[];
  sites: SiteOption[];
  tickets: TicketOption[];
  commercialLinks: CommercialLink[];
}) {
  const router = useRouter();

  // Data state
  const [items, setItems] = useState<UnifiedItem[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total: 0,
    email: 0,
    whatsapp: 0,
    manual: 0,
    needsTriage: 0,
  });
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterSource, setFilterSource] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");

  // Manual entry sheet
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSubject, setManualSubject] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);

  // Convert dialog
  const [convertItem, setConvertItem] = useState<UnifiedItem | null>(null);
  const [convertCustomerId, setConvertCustomerId] = useState("");
  const [convertSiteId, setConvertSiteId] = useState("");
  const [convertTitle, setConvertTitle] = useState("");
  const [convertMode, setConvertMode] = useState("DIRECT_ORDER");
  const [convertSubmitting, setConvertSubmitting] = useState(false);

  // Link dialog
  const [linkItem, setLinkItem] = useState<UnifiedItem | null>(null);
  const [linkTicketId, setLinkTicketId] = useState("");
  const [linkSubmitting, setLinkSubmitting] = useState(false);

  // ── Fetch items ────────────────────────────────────────────────────────

  async function fetchItems() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterSource !== "ALL") params.set("source", filterSource);
      if (filterStatus !== "ALL") params.set("status", filterStatus);
      const res = await fetch(`/api/inbox?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
        setSummary(data.summary);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSource, filterStatus]);

  // ── Actions ────────────────────────────────────────────────────────────

  async function handleDismiss(item: UnifiedItem) {
    await fetch(`/api/inbox/${item.id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss", itemType: item.itemType }),
    });
    fetchItems();
  }

  async function handleConvert() {
    if (!convertItem || !convertCustomerId || !convertTitle || !convertMode)
      return;
    setConvertSubmitting(true);

    // Find the commercial link to get siteCommercialLinkId
    const link = commercialLinks.find(
      (cl) =>
        cl.customerId === convertCustomerId && cl.siteId === convertSiteId
    );

    try {
      const res = await fetch(`/api/inbox/${convertItem.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "convert",
          itemType: convertItem.itemType,
          payingCustomerId: convertCustomerId,
          title: convertTitle,
          ticketMode: convertMode,
          siteId: convertSiteId || undefined,
          siteCommercialLinkId: link?.id || undefined,
        }),
      });
      if (res.ok) {
        setConvertItem(null);
        resetConvertForm();
        fetchItems();
        router.refresh();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to convert");
      }
    } finally {
      setConvertSubmitting(false);
    }
  }

  async function handleLink() {
    if (!linkItem || !linkTicketId) return;
    setLinkSubmitting(true);
    try {
      const res = await fetch(`/api/inbox/${linkItem.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          itemType: linkItem.itemType,
          ticketId: linkTicketId,
        }),
      });
      if (res.ok) {
        setLinkItem(null);
        setLinkTicketId("");
        fetchItems();
        router.refresh();
      }
    } finally {
      setLinkSubmitting(false);
    }
  }

  async function handleManualSubmit() {
    if (!manualSubject) return;
    setManualSubmitting(true);
    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: manualSubject,
          description: manualDescription,
          sourceType: "MANUAL",
        }),
      });
      if (res.ok) {
        setManualOpen(false);
        setManualSubject("");
        setManualDescription("");
        fetchItems();
      }
    } finally {
      setManualSubmitting(false);
    }
  }

  function openConvert(item: UnifiedItem) {
    setConvertItem(item);
    setConvertTitle(item.subject);
    setConvertCustomerId(item.customerId || "");
    setConvertSiteId(item.siteId || "");
    setConvertMode(item.classification && TICKET_MODES.includes(item.classification) ? item.classification : "DIRECT_ORDER");
  }

  function resetConvertForm() {
    setConvertCustomerId("");
    setConvertSiteId("");
    setConvertTitle("");
    setConvertMode("DIRECT_ORDER");
  }

  // Filtered sites based on selected customer's commercial links
  const filteredSites = convertCustomerId
    ? commercialLinks
        .filter((cl) => cl.customerId === convertCustomerId)
        .map((cl) => cl.site)
    : sites;

  // Only billing-entity customers for ticket creation
  const billingCustomers = customers.filter((c) => c.isBillingEntity);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-wider text-[#FF6600] bb-mono">
            INBOX
          </h1>
          <p className="text-[11px] text-[#666666] bb-mono tracking-wide">
            UNIFIED INCOMING WORK
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchItems()}
            className="text-[11px] bb-mono"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            REFRESH
          </Button>
          <Sheet open={manualOpen} onOpenChange={setManualOpen}>
            <Button
              size="sm"
              onClick={() => setManualOpen(true)}
              className="text-[11px] bb-mono bg-[#FF6600] hover:bg-[#FF6600]/80 text-black"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              MANUAL ENTRY
            </Button>
            <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333] w-[400px] sm:max-w-[400px]">
              <SheetHeader>
                <SheetTitle className="text-[#FF6600] bb-mono tracking-wider">
                  MANUAL ENTRY
                </SheetTitle>
                <SheetDescription className="text-[#666666]">
                  Add a new item to the inbox manually
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 p-4">
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-[#888888] bb-mono">
                    SUBJECT
                  </Label>
                  <Input
                    value={manualSubject}
                    onChange={(e) => setManualSubject(e.target.value)}
                    placeholder="Enter subject..."
                    className="bg-[#111111] border-[#333333] text-[#CCCCCC] text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-[#888888] bb-mono">
                    DESCRIPTION
                  </Label>
                  <Textarea
                    value={manualDescription}
                    onChange={(e) => setManualDescription(e.target.value)}
                    placeholder="Enter details..."
                    className="bg-[#111111] border-[#333333] text-[#CCCCCC] text-sm min-h-[120px]"
                  />
                </div>
              </div>
              <SheetFooter>
                <Button
                  onClick={handleManualSubmit}
                  disabled={!manualSubject || manualSubmitting}
                  className="bg-[#FF6600] hover:bg-[#FF6600]/80 text-black text-[11px] bb-mono"
                >
                  {manualSubmitting ? "ADDING..." : "ADD TO INBOX"}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "TOTAL", value: summary.total, color: "#FF6600" },
          { label: "EMAIL", value: summary.email, color: "#3399FF" },
          { label: "WHATSAPP", value: summary.whatsapp, color: "#00CC66" },
          { label: "MANUAL", value: summary.manual, color: "#CC66FF" },
          {
            label: "NEEDS TRIAGE",
            value: summary.needsTriage,
            color: "#FF3333",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-[#1A1A1A] border border-[#333333] rounded-lg p-3"
          >
            <div
              className="text-[10px] tracking-wider bb-mono"
              style={{ color: card.color }}
            >
              {card.label}
            </div>
            <div className="text-2xl font-bold text-[#CCCCCC] bb-mono mt-1">
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#666666] bb-mono tracking-wider">
            SOURCE
          </span>
          <Select value={filterSource} onValueChange={(v) => setFilterSource(v ?? "ALL")}>
            <SelectTrigger className="bg-[#111111] border-[#333333] text-[#CCCCCC] text-[11px] bb-mono h-7 w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#1A1A1A] border-[#333333]">
              <SelectItem value="ALL" label="ALL">ALL</SelectItem>
              <SelectItem value="EMAIL" label="EMAIL">EMAIL</SelectItem>
              <SelectItem value="WHATSAPP" label="WHATSAPP">WHATSAPP</SelectItem>
              <SelectItem value="MANUAL" label="MANUAL">MANUAL</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#666666] bb-mono tracking-wider">
            STATUS
          </span>
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v ?? "ALL")}>
            <SelectTrigger className="bg-[#111111] border-[#333333] text-[#CCCCCC] text-[11px] bb-mono h-7 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#1A1A1A] border-[#333333]">
              <SelectItem value="ALL" label="ALL">ALL</SelectItem>
              <SelectItem value="NEEDS_ACTION" label="NEEDS ACTION">NEEDS ACTION</SelectItem>
              <SelectItem value="DISMISSED" label="DISMISSED">DISMISSED</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="border border-[#333333] rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-[#333333] hover:bg-transparent">
              <TableHead className="text-[10px] text-[#666666] bb-mono tracking-wider w-[90px]">
                SOURCE
              </TableHead>
              <TableHead className="text-[10px] text-[#666666] bb-mono tracking-wider">
                SUBJECT
              </TableHead>
              <TableHead className="text-[10px] text-[#666666] bb-mono tracking-wider w-[140px]">
                SITE
              </TableHead>
              <TableHead className="text-[10px] text-[#666666] bb-mono tracking-wider w-[140px]">
                CUSTOMER
              </TableHead>
              <TableHead className="text-[10px] text-[#666666] bb-mono tracking-wider w-[120px]">
                CLASS
              </TableHead>
              <TableHead className="text-[10px] text-[#666666] bb-mono tracking-wider w-[60px]">
                CONF
              </TableHead>
              <TableHead className="text-[10px] text-[#666666] bb-mono tracking-wider w-[80px]">
                RECEIVED
              </TableHead>
              <TableHead className="text-[10px] text-[#666666] bb-mono tracking-wider w-[200px] text-right">
                ACTIONS
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-[#666666] py-8 text-sm"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-[#666666] py-8"
                >
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-8 w-8 text-[#444444]" />
                    <span className="text-sm">No inbox items</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow
                  key={`${item.itemType}-${item.id}`}
                  className="border-b border-[#2A2A2A] hover:bg-[#1A1A1A]"
                >
                  <TableCell className="py-2">
                    {sourceBadge(item.sourceType)}
                  </TableCell>
                  <TableCell className="py-2">
                    <div className="text-[12px] text-[#CCCCCC] line-clamp-1">
                      {item.subject}
                    </div>
                    {typeof item.rawText === "string" && item.rawText && (
                      <div className="text-[10px] text-[#555555] line-clamp-1 mt-0.5">
                        {item.rawText.substring(0, 100)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-[11px] text-[#999999]">
                    {item.suggestedSiteName || (
                      <span className="text-[#444444]">--</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-[11px] text-[#999999]">
                    {item.suggestedCustomerName || (
                      <span className="text-[#444444]">--</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2">
                    {classificationBadge(item.classification)}
                  </TableCell>
                  <TableCell className="py-2">
                    {confidenceDot(item.confidenceScore)}
                  </TableCell>
                  <TableCell className="py-2 text-[11px] text-[#888888] bb-mono">
                    {relativeTime(item.receivedAt)}
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => openConvert(item)}
                        className="text-[10px] bb-mono border-[#333333] text-[#00CC66] hover:bg-[#00CC66]/10"
                      >
                        <Ticket className="h-3 w-3 mr-0.5" />
                        TICKET
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          setLinkItem(item);
                          setLinkTicketId("");
                        }}
                        className="text-[10px] bb-mono border-[#333333] text-[#3399FF] hover:bg-[#3399FF]/10"
                      >
                        <Link2 className="h-3 w-3 mr-0.5" />
                        LINK
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleDismiss(item)}
                        className="text-[10px] bb-mono border-[#333333] text-[#FF3333] hover:bg-[#FF3333]/10"
                      >
                        <XCircle className="h-3 w-3 mr-0.5" />
                        DISMISS
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Convert to Ticket Dialog */}
      <Dialog
        open={!!convertItem}
        onOpenChange={(open) => {
          if (!open) {
            setConvertItem(null);
            resetConvertForm();
          }
        }}
      >
        <DialogContent className="bg-[#1A1A1A] border-[#333333] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#FF6600] bb-mono tracking-wider">
              CONVERT TO TICKET
            </DialogTitle>
            <DialogDescription className="text-[#666666] text-[11px]">
              Create a new ticket from this inbox item
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-[10px] text-[#888888] bb-mono">
                TITLE
              </Label>
              <Input
                value={convertTitle}
                onChange={(e) => setConvertTitle(e.target.value)}
                className="bg-[#111111] border-[#333333] text-[#CCCCCC] text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] text-[#888888] bb-mono">
                PAYING CUSTOMER *
              </Label>
              <Select
                value={convertCustomerId}
                onValueChange={(val) => {
                  setConvertCustomerId(val ?? "");
                  setConvertSiteId("");
                }}
              >
                <SelectTrigger className="bg-[#111111] border-[#333333] text-[#CCCCCC] text-[11px] w-full">
                  <SelectValue placeholder="Select customer..." />
                </SelectTrigger>
                <SelectContent className="bg-[#1A1A1A] border-[#333333] max-h-[200px]">
                  {billingCustomers.map((c) => (
                    <SelectItem key={c.id} value={c.id} label={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] text-[#888888] bb-mono">
                SITE
              </Label>
              <Select
                value={convertSiteId}
                onValueChange={(v) => setConvertSiteId(v ?? "")}
              >
                <SelectTrigger className="bg-[#111111] border-[#333333] text-[#CCCCCC] text-[11px] w-full">
                  <SelectValue placeholder="Select site..." />
                </SelectTrigger>
                <SelectContent className="bg-[#1A1A1A] border-[#333333] max-h-[200px]">
                  {filteredSites.map((s) => (
                    <SelectItem key={s.id} value={s.id} label={s.siteName}>
                      {s.siteName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] text-[#888888] bb-mono">
                TICKET MODE *
              </Label>
              <Select value={convertMode} onValueChange={(v) => setConvertMode(v ?? "DIRECT_ORDER")}>
                <SelectTrigger className="bg-[#111111] border-[#333333] text-[#CCCCCC] text-[11px] w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1A1A1A] border-[#333333]">
                  {TICKET_MODES.map((m) => (
                    <SelectItem key={m} value={m} label={m.replace(/_/g, " ")}>
                      {m.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="bg-transparent border-0 p-0 m-0 flex-row justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setConvertItem(null);
                resetConvertForm();
              }}
              className="text-[11px] bb-mono border-[#333333]"
            >
              CANCEL
            </Button>
            <Button
              size="sm"
              onClick={handleConvert}
              disabled={
                !convertCustomerId || !convertTitle || !convertMode || convertSubmitting
              }
              className="bg-[#FF6600] hover:bg-[#FF6600]/80 text-black text-[11px] bb-mono"
            >
              {convertSubmitting ? "CREATING..." : "CREATE TICKET"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link to Ticket Dialog */}
      <Dialog
        open={!!linkItem}
        onOpenChange={(open) => {
          if (!open) {
            setLinkItem(null);
            setLinkTicketId("");
          }
        }}
      >
        <DialogContent className="bg-[#1A1A1A] border-[#333333] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#FF6600] bb-mono tracking-wider">
              LINK TO TICKET
            </DialogTitle>
            <DialogDescription className="text-[#666666] text-[11px]">
              Attach this item to an existing active ticket
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {linkItem && (
              <div className="bg-[#111111] border border-[#333333] rounded p-2 text-[11px] text-[#999999]">
                <span className="text-[#666666]">Item:</span>{" "}
                {linkItem.subject}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-[#888888] bb-mono">
                SELECT TICKET *
              </Label>
              <Select value={linkTicketId} onValueChange={(v) => setLinkTicketId(v ?? "")}>
                <SelectTrigger className="bg-[#111111] border-[#333333] text-[#CCCCCC] text-[11px] w-full">
                  <SelectValue placeholder="Choose a ticket..." />
                </SelectTrigger>
                <SelectContent className="bg-[#1A1A1A] border-[#333333] max-h-[200px]">
                  {tickets.map((t) => (
                    <SelectItem
                      key={t.id}
                      value={t.id}
                      label={`#${t.ticketNo} - ${t.title}`}
                    >
                      #{t.ticketNo} - {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="bg-transparent border-0 p-0 m-0 flex-row justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLinkItem(null);
                setLinkTicketId("");
              }}
              className="text-[11px] bb-mono border-[#333333]"
            >
              CANCEL
            </Button>
            <Button
              size="sm"
              onClick={handleLink}
              disabled={!linkTicketId || linkSubmitting}
              className="bg-[#FF6600] hover:bg-[#FF6600]/80 text-black text-[11px] bb-mono"
            >
              {linkSubmitting ? "LINKING..." : "LINK TICKET"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
