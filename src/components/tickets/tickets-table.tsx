"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
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
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

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
] as const;

const TICKET_STATUSES = [
  "CAPTURED",
  "PRICING",
  "QUOTED",
  "APPROVED",
  "ORDERED",
  "DELIVERED",
  "COSTED",
  "PENDING_PO",
  "RECOVERY",
  "VERIFIED",
  "LOCKED",
  "INVOICED",
  "CLOSED",
] as const;

type TicketRow = {
  id: string;
  ticketNo: number;
  title: string;
  description: string | null;
  ticketMode: string;
  status: string;
  revenueState: string;
  createdAt: Date;
  payingCustomer: { id: string; name: string };
  site: { id: string; siteName: string } | null;
  _count: { lines: number };
};

type SelectOption = { id: string; name?: string; siteName?: string };

function statusVariant(
  status: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "CAPTURED":
      return "outline";
    case "PRICING":
    case "QUOTED":
      return "secondary";
    case "APPROVED":
    case "ORDERED":
    case "DELIVERED":
      return "default";
    case "RECOVERY":
    case "PENDING_PO":
      return "destructive";
    case "INVOICED":
    case "CLOSED":
      return "secondary";
    default:
      return "outline";
  }
}

type CommercialLink = { id: string; customerId: string; siteId: string; site: { id: string; siteName: string } };

export function TicketsTable({
  tickets,
  customers,
  sites,
  commercialLinks = [],
}: {
  tickets: TicketRow[];
  customers: SelectOption[];
  sites: SelectOption[];
  commercialLinks?: CommercialLink[];
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Status groups for quick filters
  const activeStatuses = ["CAPTURED", "PRICING", "QUOTED", "APPROVED", "ORDERED", "DELIVERED", "COSTED", "PENDING_PO"];
  const closedStatuses = ["INVOICED", "CLOSED", "VERIFIED", "LOCKED"];

  const filtered = tickets.filter((t) => {
    // Status filter
    if (statusFilter === "ACTIVE" && !activeStatuses.includes(t.status)) return false;
    if (statusFilter === "CLOSED" && !closedStatuses.includes(t.status)) return false;
    if (statusFilter !== "ALL" && statusFilter !== "ACTIVE" && statusFilter !== "CLOSED" && t.status !== statusFilter) return false;
    // Search
    if (search) {
      const q = search.toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        t.payingCustomer.name.toLowerCase().includes(q) ||
        (t.site?.siteName || "").toLowerCase().includes(q) ||
        `t-${t.ticketNo}`.includes(q)
      );
    }
    return true;
  });

  // Sort: active tickets by status priority, then by most recent
  const statusOrder: Record<string, number> = {
    ORDERED: 0, APPROVED: 1, DELIVERED: 2, PRICING: 3, QUOTED: 4,
    CAPTURED: 5, COSTED: 6, PENDING_PO: 7, INVOICED: 8, CLOSED: 9,
    RECOVERY: 10, VERIFIED: 11, LOCKED: 12,
  };
  const sorted = [...filtered].sort((a, b) => {
    const sa = statusOrder[a.status] ?? 99;
    const sb = statusOrder[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const [ticketMode, setTicketMode] = useState<string>("DIRECT_ORDER");
  const [payingCustomerId, setPayingCustomerId] = useState<string>("");
  const [siteId, setSiteId] = useState<string>("");
  const [status, setStatus] = useState<string>("CAPTURED");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);

    const form = e.currentTarget;
    const formData = new FormData(form);

    const body = {
      title: formData.get("title") as string,
      description: (formData.get("description") as string) || undefined,
      ticketMode,
      payingCustomerId,
      siteId: siteId || undefined,
      status,
    };

    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        form.reset();
        setOpen(false);
        setTicketMode("DIRECT_ORDER");
        setPayingCustomerId("");
        setSiteId("");
        setStatus("CAPTURED");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Tickets</h1>
          <p className="text-xs text-[#666666] mt-1">
            All work tickets across sites and customers
          </p>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                <Plus className="size-4 mr-1" />
                Add Ticket
              </Button>
            }
          />
          <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
            <SheetHeader>
              <SheetTitle className="text-[#E0E0E0]">Add New Ticket</SheetTitle>
              <SheetDescription className="text-[#666666]">
                Create a new work ticket.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              <div className="space-y-1.5">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  name="title"
                  required
                  placeholder="e.g. Steel delivery for Block C"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="Describe the work..."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ticket Mode</Label>
                <Select value={ticketMode} onValueChange={(v) => setTicketMode(v ?? "DIRECT_ORDER")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    {TICKET_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Paying Customer *</Label>
                <Select
                  value={payingCustomerId}
                  onValueChange={(v) => {
                    setPayingCustomerId(v ?? "");
                    setSiteId("");
                    // Auto-select if customer has exactly one linked site
                    const linked = commercialLinks.filter((cl) => cl.customerId === (v ?? ""));
                    if (linked.length === 1) setSiteId(linked[0].siteId);
                  }}
                  required
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Site (optional)</Label>
                {(() => {
                  const linkedSites = payingCustomerId
                    ? commercialLinks.filter((cl) => cl.customerId === payingCustomerId).map((cl) => cl.site)
                    : sites;
                  return (
                    <Select value={siteId} onValueChange={(v) => setSiteId(v ?? "")}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={payingCustomerId && linkedSites.length === 0 ? "No linked sites" : "Select site"} />
                      </SelectTrigger>
                      <SelectContent>
                        {linkedSites.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.siteName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                })()}
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v ?? "CAPTURED")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {TICKET_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <SheetFooter>
                <Button
                  type="submit"
                  disabled={submitting || !payingCustomerId}
                  className="bg-[#FF6600] text-black hover:bg-[#FF9900]"
                >
                  {submitting ? "Creating..." : "Create Ticket"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search tickets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-xs"
        />
        <div className="flex gap-1">
          {[
            { value: "ACTIVE", label: "Active", color: "bg-[#FF6600]" },
            { value: "ORDERED", label: "Ordered", color: "bg-[#FF3333]" },
            { value: "APPROVED", label: "Approved", color: "bg-[#00CC66]" },
            { value: "PRICING", label: "Pricing", color: "bg-[#FF9900]" },
            { value: "QUOTED", label: "Quoted", color: "bg-[#3399FF]" },
            { value: "INVOICED", label: "Invoiced", color: "bg-[#9966FF]" },
            { value: "CLOSED", label: "Closed", color: "bg-[#888888]" },
            { value: "ALL", label: "All", color: "bg-[#888888]" },
          ].map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={statusFilter === f.value ? "default" : "outline"}
              className={`h-7 text-[10px] ${statusFilter === f.value ? `${f.color} text-black` : ""}`}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
              {f.value !== "ALL" && f.value !== "ACTIVE" && f.value !== "CLOSED" && (
                <span className="ml-1 opacity-60">
                  {tickets.filter(t => t.status === f.value).length}
                </span>
              )}
              {f.value === "ACTIVE" && (
                <span className="ml-1 opacity-60">
                  {tickets.filter(t => activeStatuses.includes(t.status)).length}
                </span>
              )}
            </Button>
          ))}
        </div>
        <span className="text-[10px] text-[#888888] ml-auto">{sorted.length} tickets</span>
      </div>

      <div className="border border-[#333333] bg-[#1A1A1A]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>No</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Site</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center py-8 text-[#888888]"
                >
                  {search ? "No tickets match your search." : "No tickets found."}
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((ticket) => (
                <TableRow
                  key={ticket.id}
                  className="cursor-pointer hover:bg-[#222222]"
                  onClick={() => router.push(`/tickets/${ticket.id}`)}
                >
                  <TableCell className="px-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-5 w-5 p-0 text-red-500 hover:text-red-400 hover:border-red-500"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Delete ticket T-${ticket.ticketNo} "${ticket.title}"?`)) return;
                        const res = await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
                        if (res.ok) {
                          router.refresh();
                        } else {
                          const err = await res.json().catch(() => null);
                          alert(err?.error || "Failed to delete ticket");
                        }
                      }}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </TableCell>
                  <TableCell className="text-[#FF6600] font-medium whitespace-nowrap">
                    T-{ticket.ticketNo}
                  </TableCell>
                  <TableCell className="font-medium max-w-[250px] truncate">
                    {ticket.title}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {ticket.ticketMode.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={statusVariant(ticket.status)}>
                        {ticket.status.replace(/_/g, " ")}
                      </Badge>
                      {ticket.revenueState !== "OPERATIONAL" && (
                        <Badge className={ticket.revenueState === "RECOVERY_PIPELINE" ? "text-[9px] bg-[#FF9900]/15 text-[#FF9900] border border-[#FF9900]/30" : "text-[9px] bg-[#00CC66]/15 text-[#00CC66] border border-[#00CC66]/30"}>
                          {ticket.revenueState === "RECOVERY_PIPELINE" ? "RECOVERY" : "REALISED"}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {ticket.payingCustomer.name}
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {ticket.site?.siteName || "\u2014"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums bb-mono text-[#E0E0E0]">
                    {ticket._count.lines}
                  </TableCell>
                  <TableCell className="text-[#888888] tabular-nums">
                    {new Date(ticket.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
