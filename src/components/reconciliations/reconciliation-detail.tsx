"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Flag = "OK" | "VERIFY" | "PRICE_FIX" | "CONFIRM" | null;
type Section = "A" | "B" | "C" | "D";
type Action =
  | "SWAP_CODE_AND_RECOST"
  | "NO_CHANGE"
  | "CONFIRM_WITH_CUSTOMER"
  | "CUSTOMER_ONLY";
type WorkflowState =
  | "DRAFT"
  | "PENDING_CUSTOMER_CONFIRMATION"
  | "CUSTOMER_APPROVED"
  | "APPLIED"
  | "CLOSED";

export type ReconciliationLineDTO = {
  id: string;
  section: Section;
  action: Action;
  flag: Flag;
  description: string;
  qty: number;
  unit: string;
  oldCode: string | null;
  newCode: string | null;
  note: string | null;
  keepFlag: boolean | null;
  appliedAt: string | null;
};

export type ReconciliationDTO = {
  id: string;
  reconciliationNo: number;
  title: string;
  type: string;
  workflowState: WorkflowState;
  notes: string | null;
  customerListSize: number;
  discrepancy: { messages: string[] } | null;
  createdAt: string;
  confirmedAt: string | null;
  appliedAt: string | null;
  parentTicket: {
    id: string;
    ticketNo: number;
    title: string;
    status: string;
    customerName: string | null;
    siteName: string | null;
  };
  lines: ReconciliationLineDTO[];
};

const STATE_LABEL: Record<WorkflowState, string> = {
  DRAFT: "Draft",
  PENDING_CUSTOMER_CONFIRMATION: "Pending customer confirmation",
  CUSTOMER_APPROVED: "Customer approved",
  APPLIED: "Applied to parent",
  CLOSED: "Closed",
};

const FLAG_CLASS: Record<NonNullable<Flag>, string> = {
  OK: "bg-emerald-100 text-emerald-800 border-emerald-200",
  VERIFY: "bg-amber-100 text-amber-800 border-amber-200",
  PRICE_FIX: "bg-red-100 text-red-800 border-red-200",
  CONFIRM: "bg-blue-100 text-blue-800 border-blue-200",
};

function FlagBadge({ flag }: { flag: Flag }) {
  if (!flag) return null;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${FLAG_CLASS[flag]}`}
    >
      {flag}
    </span>
  );
}

export function ReconciliationDetail({
  reconciliation,
}: {
  reconciliation: ReconciliationDTO;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lines, setLines] = useState<ReconciliationLineDTO[]>(
    reconciliation.lines,
  );
  const [error, setError] = useState<string | null>(null);

  const byMenu = (s: Section) => lines.filter((l) => l.section === s);
  const counts = {
    A: byMenu("A").length,
    B: byMenu("B").length,
    C: byMenu("C").length,
    D: byMenu("D").length,
  };

  const state = reconciliation.workflowState;
  const isTerminal = state === "APPLIED" || state === "CLOSED";
  const canToggleKeep =
    state === "DRAFT" ||
    state === "PENDING_CUSTOMER_CONFIRMATION" ||
    state === "CUSTOMER_APPROVED";

  async function patchState(nextState: WorkflowState) {
    setError(null);
    const res = await fetch(`/api/reconciliations/${reconciliation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowState: nextState }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "failed" }));
      setError(error ?? "State change failed");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function applyToParent() {
    setError(null);
    if (
      !confirm(
        `Apply reconciliation #${reconciliation.reconciliationNo} to CP-${String(reconciliation.parentTicket.ticketNo).padStart(4, "0")}?\n\n` +
          `This will:\n` +
          `- Swap ${counts.A} Valsir codes to Geberit equivalents (re-cost manual)\n` +
          `- Remove ${byMenu("C").filter((l) => l.keepFlag === false).length} Section C lines\n` +
          `- Keep ${byMenu("C").filter((l) => l.keepFlag !== false).length} Section C lines\n` +
          `- Reopen the parent ticket to PRICING\n\n` +
          `Parent ticket will be modified. This step is irreversible via UI.`,
      )
    )
      return;
    const res = await fetch(
      `/api/reconciliations/${reconciliation.id}/apply`,
      { method: "POST" },
    );
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "failed" }));
      setError(error ?? "Apply failed");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function toggleKeep(lineId: string, next: boolean | null) {
    setLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, keepFlag: next } : l)),
    );
    await fetch(`/api/reconciliations/${reconciliation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineUpdates: [{ id: lineId, keepFlag: next }] }),
    });
  }

  const parentRef = `CP-${String(reconciliation.parentTicket.ticketNo).padStart(4, "0")}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Reconciliation #{reconciliation.reconciliationNo}</span>
              <span>·</span>
              <span>{reconciliation.type.replace(/_/g, " ")}</span>
              <span>·</span>
              <span>Parent {parentRef}</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold">{reconciliation.title}</h1>
            <div className="mt-1 text-sm text-muted-foreground">
              {reconciliation.parentTicket.customerName ?? "Unknown customer"}
              {reconciliation.parentTicket.siteName
                ? ` · ${reconciliation.parentTicket.siteName}`
                : ""}
            </div>
          </div>
          <Badge
            className={
              state === "APPLIED"
                ? "bg-emerald-100 text-emerald-900 border-emerald-200"
                : state === "CLOSED"
                  ? "bg-zinc-100 text-zinc-700 border-zinc-200"
                  : "bg-blue-100 text-blue-900 border-blue-200"
            }
          >
            {STATE_LABEL[state]}
          </Badge>
        </div>
      </div>

      {/* Workflow actions */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-4">
          <span className="text-xs text-muted-foreground mr-2">Workflow</span>
          {state === "DRAFT" && (
            <Button
              size="sm"
              onClick={() => patchState("PENDING_CUSTOMER_CONFIRMATION")}
              disabled={isPending}
            >
              Send for customer confirmation
            </Button>
          )}
          {state === "PENDING_CUSTOMER_CONFIRMATION" && (
            <>
              <Button
                size="sm"
                onClick={() => patchState("CUSTOMER_APPROVED")}
                disabled={isPending}
              >
                Mark customer approved
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => patchState("DRAFT")}
                disabled={isPending}
              >
                Back to draft
              </Button>
            </>
          )}
          {state === "CUSTOMER_APPROVED" && (
            <>
              <Button size="sm" onClick={applyToParent} disabled={isPending}>
                Apply to parent
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => patchState("PENDING_CUSTOMER_CONFIRMATION")}
                disabled={isPending}
              >
                Back to pending
              </Button>
            </>
          )}
          {state === "APPLIED" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => patchState("CLOSED")}
              disabled={isPending}
            >
              Close reconciliation
            </Button>
          )}
          {!isTerminal && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => patchState("CLOSED")}
              disabled={isPending}
            >
              Discard &amp; close
            </Button>
          )}
          {error && (
            <span className="ml-auto text-sm text-red-600">{error}</span>
          )}
        </CardContent>
      </Card>

      {/* Discrepancy surface */}
      {reconciliation.discrepancy && reconciliation.discrepancy.messages.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-900">Discrepancies detected</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-amber-900">
            {reconciliation.discrepancy.messages.map((m, i) => (
              <div key={i}>• {m}</div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryTile label="Geberit Silent DB20 HDPE" count={counts.A} colour="purple" expected={9} />
        <SummaryTile label="B · Matched" count={counts.B} colour="green" expected={49} />
        <SummaryTile
          label="C · Customer omitted"
          count={counts.C}
          colour="amber"
          expected={7}
        />
        <SummaryTile
          label="D · Customer only"
          count={counts.D}
          colour="red"
          expected={0}
        />
      </div>

      {/* Section A */}
      <SectionBlock title="Geberit Silent DB20 HDPE" colour="purple">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-3">Code swap</th>
              <th className="pr-3">Description</th>
              <th className="pr-3 text-right">Qty</th>
              <th className="pr-3">Unit</th>
              <th className="pr-3">Flag</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {byMenu("A").map((l) => (
              <tr key={l.id} className="border-b last:border-b-0">
                <td className="py-2 pr-3">
                  <div className="flex flex-col gap-0.5 font-mono text-xs">
                    <span className="text-red-600 line-through">{l.oldCode}</span>
                    <span className="font-semibold text-emerald-700">{l.newCode}</span>
                  </div>
                </td>
                <td className="pr-3">{l.description}</td>
                <td className="pr-3 text-right">{l.qty}</td>
                <td className="pr-3">{l.unit}</td>
                <td className="pr-3">
                  <FlagBadge flag={l.flag} />
                </td>
                <td className="text-xs text-muted-foreground">{l.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionBlock>

      {/* Section B */}
      <SectionBlock title="Section B — Matched lines, cross-referenced OK" colour="green">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-3">Description</th>
              <th className="pr-3 text-right">Qty</th>
              <th className="pr-3">Unit</th>
              <th className="pr-3">Flag</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {byMenu("B").map((l) => (
              <tr key={l.id} className="border-b last:border-b-0">
                <td className="py-2 pr-3">{l.description}</td>
                <td className="pr-3 text-right">{l.qty}</td>
                <td className="pr-3">{l.unit}</td>
                <td className="pr-3">
                  <FlagBadge flag={l.flag} />
                </td>
                <td className="text-xs text-muted-foreground">{l.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionBlock>

      {/* Section C */}
      <SectionBlock
        title="Section C — On parent but NOT on customer's revised list"
        colour="amber"
      >
        {byMenu("C").length === 0 ? (
          <div className="text-sm text-muted-foreground">None.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">Description</th>
                <th className="pr-3 text-right">Qty</th>
                <th className="pr-3">Unit</th>
                <th className="pr-3">Keep / Remove</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {byMenu("C").map((l) => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-3">{l.description}</td>
                  <td className="pr-3 text-right">{l.qty}</td>
                  <td className="pr-3">{l.unit}</td>
                  <td className="pr-3">
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant={l.keepFlag === true ? "default" : "outline"}
                        onClick={() => toggleKeep(l.id, true)}
                        disabled={!canToggleKeep}
                      >
                        Keep
                      </Button>
                      <Button
                        size="sm"
                        variant={l.keepFlag === false ? "destructive" : "outline"}
                        onClick={() => toggleKeep(l.id, false)}
                        disabled={!canToggleKeep}
                      >
                        Remove
                      </Button>
                    </div>
                  </td>
                  <td className="text-xs text-muted-foreground">{l.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionBlock>

      {/* Section D */}
      <SectionBlock
        title="Section D — On customer's list but NOT on parent"
        colour="red"
      >
        {byMenu("D").length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              ✓
            </span>
            Nothing missing — every line on the customer's revised list is represented on the parent ticket.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">Customer description</th>
                <th className="pr-3">Customer code</th>
                <th className="pr-3 text-right">Qty</th>
                <th className="pr-3">Unit</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {byMenu("D").map((l) => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-3">{l.description}</td>
                  <td className="pr-3 font-mono text-xs">{l.newCode ?? "—"}</td>
                  <td className="pr-3 text-right">{l.qty}</td>
                  <td className="pr-3">{l.unit}</td>
                  <td className="text-xs text-muted-foreground">{l.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionBlock>
    </div>
  );
}

function SummaryTile({
  label,
  count,
  colour,
  expected,
}: {
  label: string;
  count: number;
  colour: "purple" | "green" | "amber" | "red";
  expected: number;
}) {
  const palette = {
    purple: "border-l-purple-500 bg-purple-50",
    green: "border-l-emerald-500 bg-emerald-50",
    amber: "border-l-amber-500 bg-amber-50",
    red: "border-l-red-500 bg-red-50",
  }[colour];
  const mismatch = count !== expected;
  return (
    <div className={`rounded-md border border-l-4 px-4 py-3 ${palette}`}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{count}</span>
        <span
          className={`text-xs ${mismatch ? "text-amber-700" : "text-muted-foreground"}`}
        >
          expected {expected}
          {mismatch ? " ·" : ""}
          {mismatch ? " review" : ""}
        </span>
      </div>
    </div>
  );
}

function SectionBlock({
  title,
  colour,
  children,
}: {
  title: string;
  colour: "purple" | "green" | "amber" | "red";
  children: React.ReactNode;
}) {
  const palette = {
    purple: "border-l-purple-500",
    green: "border-l-emerald-500",
    amber: "border-l-amber-500",
    red: "border-l-red-500",
  }[colour];
  return (
    <Card className={`border-l-4 ${palette}`}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
