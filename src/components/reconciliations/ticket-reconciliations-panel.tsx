import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Recon = {
  id: string;
  reconciliationNo: number;
  title: string;
  type: string;
  workflowState:
    | "DRAFT"
    | "PENDING_CUSTOMER_CONFIRMATION"
    | "CUSTOMER_APPROVED"
    | "APPLIED"
    | "CLOSED";
  createdAt: string;
  lineCount: number;
};

const STATE_LABEL: Record<Recon["workflowState"], string> = {
  DRAFT: "Draft",
  PENDING_CUSTOMER_CONFIRMATION: "Pending customer",
  CUSTOMER_APPROVED: "Customer approved",
  APPLIED: "Applied",
  CLOSED: "Closed",
};

const STATE_CLASS: Record<Recon["workflowState"], string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 border-zinc-200",
  PENDING_CUSTOMER_CONFIRMATION: "bg-blue-100 text-blue-800 border-blue-200",
  CUSTOMER_APPROVED: "bg-indigo-100 text-indigo-800 border-indigo-200",
  APPLIED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  CLOSED: "bg-zinc-100 text-zinc-500 border-zinc-200",
};

export function TicketReconciliationsPanel({
  parentTicketId,
  reconciliations,
}: {
  parentTicketId: string;
  reconciliations: Recon[];
}) {
  if (reconciliations.length === 0) return null;
  return (
    <Card className="mb-4 border-l-4 border-l-purple-500">
      <CardHeader>
        <CardTitle className="text-base">
          Reconciliations ({reconciliations.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {reconciliations.map((r) => (
          <Link
            key={r.id}
            href={`/tickets/${parentTicketId}/reconciliations/${r.id}`}
            className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted"
          >
            <div className="flex flex-col">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Reconciliation #{r.reconciliationNo}</span>
                <span>·</span>
                <span>{r.type.replace(/_/g, " ")}</span>
                <span>·</span>
                <span>{r.lineCount} lines</span>
              </div>
              <div className="text-sm font-medium">{r.title}</div>
            </div>
            <Badge className={STATE_CLASS[r.workflowState]}>
              {STATE_LABEL[r.workflowState]}
            </Badge>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
