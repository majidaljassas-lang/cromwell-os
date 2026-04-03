"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ArrowRightCircle,
  Inbox,
  Ticket,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Decimal = { toString(): string } | string | number | null;

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type WorkItem = {
  id: string;
  mode: string;
  status: string;
  confidenceScore: Decimal;
  notes: string | null;
  createdAt: Date;
  enquiry: {
    id: string;
    subjectOrLabel: string | null;
    rawText: string;
  };
  site: { id: string; siteName: string } | null;
  customer: { id: string; name: string } | null;
};

type ActiveTicket = {
  id: string;
  title: string;
  ticketMode: string;
  status: string;
  createdAt: Date;
  payingCustomer: { id: string; name: string };
  site: { id: string; siteName: string } | null;
  _count: { lines: number };
};

type RecoveryCaseRow = {
  id: string;
  reasonType: string;
  recoveryStatus: string;
  stuckValue: Decimal;
  nextAction: string | null;
  currentStageStartedAt: Date | null;
  createdAt: Date;
  ticket: {
    id: string;
    title: string;
    payingCustomer: { id: string; name: string };
  };
};

function statusVariant(
  status: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "OPEN":
    case "CAPTURED":
      return "outline";
    case "PRICING":
    case "QUOTED":
    case "QUOTE_SENT":
      return "secondary";
    case "APPROVED":
    case "ORDERED":
    case "DELIVERED":
    case "READY_TO_CONVERT":
      return "default";
    case "RECOVERY":
    case "PENDING_PO":
    case "PO_MISMATCH":
      return "destructive";
    default:
      return "outline";
  }
}

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  const diff = Date.now() - new Date(date).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function CollapsibleSection({
  title,
  icon: Icon,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border bg-background">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{title}</h2>
          <Badge variant="secondary">{count}</Badge>
        </div>
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
      </button>
      {open && <div className="border-t">{children}</div>}
    </div>
  );
}

export function WorkQueue({
  workItems,
  activeTickets,
  recoveryCases,
}: {
  workItems: WorkItem[];
  activeTickets: ActiveTicket[];
  recoveryCases: RecoveryCaseRow[];
}) {
  const router = useRouter();
  const [converting, setConverting] = useState<string | null>(null);

  async function handleConvertToTicket(workItemId: string) {
    setConverting(workItemId);
    try {
      const res = await fetch(
        `/api/work-items/${workItemId}/convert-to-ticket`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setConverting(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Work Queue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Unified action list - all open work across enquiries, tickets, and
          recovery
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-background p-4">
          <div className="flex items-center gap-2">
            <Inbox className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Inquiry Work Items</span>
          </div>
          <p className="text-2xl font-bold mt-1 tabular-nums">
            {workItems.length}
          </p>
        </div>
        <div className="rounded-lg border bg-background p-4">
          <div className="flex items-center gap-2">
            <Ticket className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Active Tickets</span>
          </div>
          <p className="text-2xl font-bold mt-1 tabular-nums">
            {activeTickets.length}
          </p>
        </div>
        <div className="rounded-lg border bg-background p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Recovery Cases</span>
          </div>
          <p className="text-2xl font-bold mt-1 tabular-nums">
            {recoveryCases.length}
          </p>
        </div>
      </div>

      {/* Inquiry Work Items */}
      <CollapsibleSection
        title="Inquiry Work Items"
        icon={Inbox}
        count={workItems.length}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Confidence</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workItems.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-6 text-muted-foreground"
                >
                  No open inquiry work items.
                </TableCell>
              </TableRow>
            ) : (
              workItems.map((wi) => (
                <TableRow key={wi.id}>
                  <TableCell className="font-medium max-w-[200px] truncate">
                    {wi.enquiry.subjectOrLabel ||
                      wi.enquiry.rawText.slice(0, 40)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {wi.mode.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(wi.status)}>
                      {wi.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {wi.site?.siteName || "\u2014"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {wi.customer?.name || "\u2014"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {wi.confidenceScore
                      ? `${Number(wi.confidenceScore.toString())}%`
                      : "\u2014"}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[150px] truncate">
                    {wi.notes || "\u2014"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleConvertToTicket(wi.id)}
                      disabled={converting === wi.id}
                    >
                      <ArrowRightCircle className="size-4 mr-1" />
                      {converting === wi.id ? "Converting..." : "To Ticket"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CollapsibleSection>

      {/* Active Tickets */}
      <CollapsibleSection
        title="Active Tickets"
        icon={Ticket}
        count={activeTickets.length}
      >
        <Table>
          <TableHeader>
            <TableRow>
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
            {activeTickets.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-6 text-muted-foreground"
                >
                  No active tickets.
                </TableCell>
              </TableRow>
            ) : (
              activeTickets.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/tickets/${t.id}`)}
                >
                  <TableCell className="font-medium max-w-[250px] truncate">
                    {t.title}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t.ticketMode.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(t.status)}>
                      {t.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.payingCustomer.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.site?.siteName || "\u2014"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t._count.lines}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CollapsibleSection>

      {/* Recovery Cases */}
      <CollapsibleSection
        title="Recovery Cases"
        icon={AlertTriangle}
        count={recoveryCases.length}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket</TableHead>
              <TableHead>Recovery Status</TableHead>
              <TableHead className="text-right">Stuck Value</TableHead>
              <TableHead className="text-right">Days in Stage</TableHead>
              <TableHead>Next Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recoveryCases.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-6 text-muted-foreground"
                >
                  No open recovery cases.
                </TableCell>
              </TableRow>
            ) : (
              recoveryCases.map((rc) => {
                const days = daysSince(rc.currentStageStartedAt);
                return (
                  <TableRow
                    key={rc.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/tickets/${rc.ticket.id}`)}
                  >
                    <TableCell className="font-medium max-w-[250px] truncate">
                      {rc.ticket.title}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(rc.recoveryStatus)}>
                        {rc.recoveryStatus.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {dec(rc.stuckValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {days !== null ? (
                        <span
                          className={
                            days > 7
                              ? "text-destructive font-medium"
                              : "text-muted-foreground"
                          }
                        >
                          {days}d
                        </span>
                      ) : (
                        "\u2014"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">
                      {rc.nextAction || "\u2014"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CollapsibleSection>
    </div>
  );
}
