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

export function TicketsTable({
  tickets,
  customers,
  sites,
}: {
  tickets: TicketRow[];
  customers: SelectOption[];
  sites: SelectOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
                  onValueChange={(v) => setPayingCustomerId(v ?? "")}
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
                <Select value={siteId} onValueChange={(v) => setSiteId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select site" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.siteName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
            {tickets.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center py-8 text-[#888888]"
                >
                  No tickets found. Create your first ticket to get started.
                </TableCell>
              </TableRow>
            ) : (
              tickets.map((ticket) => (
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
                        await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
                        router.refresh();
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
