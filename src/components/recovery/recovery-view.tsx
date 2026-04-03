"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Package,
  Send,
  Paperclip,
  Unlock,
  FileText,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import Link from "next/link";

type Decimal = { toString(): string } | string | number | null;

function num(val: Decimal): number {
  if (val === null || val === undefined) return 0;
  return Number(val.toString());
}

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function daysAgo(date: string | Date | null): number {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

const STAGES = [
  "OPEN",
  "EVIDENCE_BUILDING",
  "PACK_READY",
  "PACK_SENT_FOR_PO",
  "AWAITING_PO",
  "PO_RECEIVED",
  "PO_ALLOCATED",
  "INVOICE_READY",
  "INVOICE_SENT",
  "PAYMENT_PENDING",
  "CLOSED",
] as const;

const STAGE_LABELS: Record<string, string> = {
  OPEN: "Open",
  EVIDENCE_BUILDING: "Evidence Building",
  PACK_READY: "Pack Ready",
  PACK_SENT_FOR_PO: "Sent for PO",
  AWAITING_PO: "Awaiting PO",
  PO_RECEIVED: "PO Received",
  PO_ALLOCATED: "PO Allocated",
  INVOICE_READY: "Invoice Ready",
  INVOICE_SENT: "Invoice Sent",
  PAYMENT_PENDING: "Payment Pending",
  CLOSED: "Closed",
};

type EvidencePackSummary = {
  id: string;
  packType: string;
  status: string;
  generatedAt: string | null;
  finalizedAt: string | null;
  _count: { items: number };
};

type RecoveryCase = {
  id: string;
  ticketId: string;
  reasonType: string;
  recoveryStatus: string;
  currentStageStartedAt: string | null;
  packSentAt: string | null;
  poRequestedAt: string | null;
  poReceivedAt: string | null;
  invoiceUnlockedAt: string | null;
  invoiceSentAt: string | null;
  nextAction: string | null;
  stuckValue: Decimal;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  ticket: {
    id: string;
    title: string;
    payingCustomer: { id: string; name: string };
    site: { id: string; siteName: string } | null;
  };
  evidencePacks: EvidencePackSummary[];
};

function statusColor(status: string): string {
  switch (status) {
    case "OPEN": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "EVIDENCE_BUILDING": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "PACK_READY": return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300";
    case "PACK_SENT_FOR_PO":
    case "AWAITING_PO": return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
    case "PO_RECEIVED":
    case "PO_ALLOCATED": return "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300";
    case "INVOICE_READY":
    case "INVOICE_SENT": return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
    case "PAYMENT_PENDING": return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    case "CLOSED": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300";
  }
}

function getNextActionLabel(status: string): string {
  switch (status) {
    case "OPEN":
    case "EVIDENCE_BUILDING": return "Build evidence pack";
    case "PACK_READY": return "Send pack for PO";
    case "PACK_SENT_FOR_PO":
    case "AWAITING_PO": return "Chase PO / Attach PO";
    case "PO_RECEIVED":
    case "PO_ALLOCATED": return "Unlock invoice";
    case "INVOICE_READY": return "Generate & send invoice";
    case "INVOICE_SENT": return "Chase payment";
    case "PAYMENT_PENDING": return "Confirm payment";
    default: return "\u2014";
  }
}

export function RecoveryView({ cases }: { cases: RecoveryCase[] }) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editNextAction, setEditNextAction] = useState<string | null>(null);
  const [nextActionText, setNextActionText] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const openCases = cases.filter((c) => c.recoveryStatus !== "CLOSED");
  const totalStuck = openCases.reduce((s, c) => s + num(c.stuckValue), 0);
  const avgDays = openCases.length > 0
    ? Math.round(openCases.reduce((s, c) => s + daysAgo(c.createdAt), 0) / openCases.length)
    : 0;
  const awaitingPO = cases.filter((c) =>
    ["PACK_SENT_FOR_PO", "AWAITING_PO"].includes(c.recoveryStatus)
  ).length;

  // Stage counts for pipeline
  const stageCounts: Record<string, number> = {};
  STAGES.forEach((s) => { stageCounts[s] = 0; });
  cases.forEach((c) => {
    if (stageCounts[c.recoveryStatus] !== undefined) {
      stageCounts[c.recoveryStatus]++;
    }
  });

  const filtered = cases.filter((c) => {
    if (statusFilter !== "ALL" && c.recoveryStatus !== statusFilter) return false;
    return true;
  });

  async function handleAction(caseId: string, action: string, body?: Record<string, unknown>) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/recovery-cases/${caseId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateNextAction(caseId: string) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/recovery-cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextAction: nextActionText }),
      });
      if (res.ok) {
        setEditNextAction(null);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function buildTimeline(c: RecoveryCase) {
    const entries: { stage: string; date: string | null }[] = [];
    if (c.openedAt) entries.push({ stage: "OPEN", date: c.openedAt });
    if (c.packSentAt) entries.push({ stage: "PACK_SENT_FOR_PO", date: c.packSentAt });
    if (c.poRequestedAt) entries.push({ stage: "PO_REQUESTED", date: c.poRequestedAt });
    if (c.poReceivedAt) entries.push({ stage: "PO_RECEIVED", date: c.poReceivedAt });
    if (c.invoiceUnlockedAt) entries.push({ stage: "INVOICE_UNLOCKED", date: c.invoiceUnlockedAt });
    if (c.invoiceSentAt) entries.push({ stage: "INVOICE_SENT", date: c.invoiceSentAt });
    if (c.closedAt) entries.push({ stage: "CLOSED", date: c.closedAt });
    entries.sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());

    // Add durations
    return entries.map((entry, i) => {
      const nextDate = entries[i + 1]?.date;
      const duration = nextDate
        ? Math.floor((new Date(nextDate).getTime() - new Date(entry.date!).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      return { ...entry, duration };
    });
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Stuck Revenue</p>
            <p className="text-2xl font-bold text-red-600">{dec(totalStuck)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Open Cases</p>
            <p className="text-2xl font-bold">{openCases.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Avg Days in Recovery</p>
            <p className="text-2xl font-bold">{avgDays}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Packs Awaiting PO</p>
            <p className="text-2xl font-bold text-orange-600">{awaitingPO}</p>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Rail */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <h3 className="text-sm font-medium mb-3 text-muted-foreground">Recovery Pipeline</h3>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {STAGES.map((stage, i) => (
              <Fragment key={stage}>
                <div className="flex flex-col items-center min-w-[80px]">
                  <div
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusColor(stage)}`}
                  >
                    {stageCounts[stage]}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-1 text-center leading-tight">
                    {STAGE_LABELS[stage] || stage.replace(/_/g, " ")}
                  </span>
                </div>
                {i < STAGES.length - 1 && (
                  <ArrowRight className="size-3 text-muted-foreground shrink-0" />
                )}
              </Fragment>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filter */}
      <div className="flex items-center gap-4">
        <div className="w-56">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "ALL")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Filter by stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Stages</SelectItem>
              {STAGES.map((s) => (
                <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Cases Table */}
      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Ticket</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Stuck Value</TableHead>
              <TableHead className="text-right">Days in Stage</TableHead>
              <TableHead className="text-right">Packs</TableHead>
              <TableHead>Next Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No recovery cases found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((rc) => {
                const isExpanded = expandedId === rc.id;
                const daysInStage = daysAgo(rc.currentStageStartedAt);
                const timeline = buildTimeline(rc);

                return (
                  <Fragment key={rc.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedId(isExpanded ? null : rc.id)}
                    >
                      <TableCell>
                        {isExpanded ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium max-w-[180px] truncate">
                        {rc.ticket.title}
                      </TableCell>
                      <TableCell>{rc.ticket.payingCustomer.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{rc.reasonType.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(rc.recoveryStatus)}`}>
                          {STAGE_LABELS[rc.recoveryStatus] || rc.recoveryStatus.replace(/_/g, " ")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-red-600">
                        {dec(rc.stuckValue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {daysInStage}d
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rc.evidencePacks.length}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-[150px] truncate">
                        {rc.nextAction || getNextActionLabel(rc.recoveryStatus)}
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={9} className="bg-muted/30 p-4">
                          <div className="space-y-4">
                            {/* Timeline */}
                            <div>
                              <h4 className="text-sm font-medium mb-2">Recovery Timeline</h4>
                              {timeline.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No timeline events recorded.</p>
                              ) : (
                                <div className="space-y-0">
                                  {timeline.map((entry, i) => (
                                    <div key={i} className="flex items-start gap-3 border-l-2 border-primary/30 pl-4 py-2">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(entry.stage)}`}>
                                            {STAGE_LABELS[entry.stage] || entry.stage.replace(/_/g, " ")}
                                          </span>
                                          <span className="text-xs text-muted-foreground">
                                            {entry.date ? new Date(entry.date).toLocaleString() : ""}
                                          </span>
                                          {entry.duration !== null && (
                                            <span className="text-xs text-muted-foreground">
                                              ({entry.duration}d)
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Evidence Packs */}
                            <div>
                              <h4 className="text-sm font-medium mb-2">Evidence Packs</h4>
                              {rc.evidencePacks.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No evidence packs.</p>
                              ) : (
                                <div className="space-y-1">
                                  {rc.evidencePacks.map((pack) => (
                                    <div key={pack.id} className="flex items-center gap-2 text-sm border rounded px-3 py-2 bg-background">
                                      <Badge variant="outline">{pack.packType}</Badge>
                                      <Badge variant={pack.status === "FINALIZED" ? "default" : "secondary"}>
                                        {pack.status}
                                      </Badge>
                                      <span className="text-muted-foreground">{pack._count.items} items</span>
                                      {pack.generatedAt && (
                                        <span className="text-xs text-muted-foreground">
                                          Generated: {new Date(pack.generatedAt).toLocaleDateString()}
                                        </span>
                                      )}
                                      {pack.finalizedAt && (
                                        <span className="text-xs text-muted-foreground">
                                          Finalized: {new Date(pack.finalizedAt).toLocaleDateString()}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2 flex-wrap">
                              {["OPEN", "EVIDENCE_BUILDING"].includes(rc.recoveryStatus) && (
                                <Button
                                  size="sm"
                                  onClick={(e) => { e.stopPropagation(); handleAction(rc.id, "build-pack"); }}
                                  disabled={submitting}
                                >
                                  <Package className="size-4 mr-1" />
                                  Build Pack
                                </Button>
                              )}
                              {rc.recoveryStatus === "PACK_READY" && (
                                <Button
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAction(rc.id, "send-for-po", {
                                      nextAction: rc.nextAction || "Chase PO from customer",
                                    });
                                  }}
                                  disabled={submitting}
                                >
                                  <Send className="size-4 mr-1" />
                                  Send for PO
                                </Button>
                              )}
                              {["PACK_SENT_FOR_PO", "AWAITING_PO"].includes(rc.recoveryStatus) && (
                                <Button
                                  size="sm"
                                  onClick={(e) => { e.stopPropagation(); handleAction(rc.id, "attach-po"); }}
                                  disabled={submitting}
                                >
                                  <Paperclip className="size-4 mr-1" />
                                  Attach PO
                                </Button>
                              )}
                              {["PO_RECEIVED", "PO_ALLOCATED"].includes(rc.recoveryStatus) && (
                                <Button
                                  size="sm"
                                  onClick={(e) => { e.stopPropagation(); handleAction(rc.id, "unlock-invoice"); }}
                                  disabled={submitting}
                                >
                                  <Unlock className="size-4 mr-1" />
                                  Unlock Invoice
                                </Button>
                              )}
                              {rc.recoveryStatus === "INVOICE_READY" && (
                                <Link href={`/tickets/${rc.ticketId}`}>
                                  <Button size="sm" variant="outline">
                                    <FileText className="size-4 mr-1" />
                                    Generate Invoice
                                  </Button>
                                </Link>
                              )}

                              {/* Update Next Action */}
                              {editNextAction === rc.id ? (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <Input
                                    value={nextActionText}
                                    onChange={(e) => setNextActionText(e.target.value)}
                                    className="h-8 w-64"
                                    placeholder="Next action..."
                                  />
                                  <Button
                                    size="sm"
                                    onClick={() => handleUpdateNextAction(rc.id)}
                                    disabled={submitting}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditNextAction(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditNextAction(rc.id);
                                    setNextActionText(rc.nextAction || "");
                                  }}
                                >
                                  <Pencil className="size-4 mr-1" />
                                  Update Next Action
                                </Button>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
