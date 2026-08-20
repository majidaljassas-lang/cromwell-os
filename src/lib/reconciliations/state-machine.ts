// Allowed reconciliation workflow transitions. APPLIED is a one-way door:
// once a reconciliation has mutated its parent ticket, it can only be closed.

import type { ReconciliationWorkflowState } from "@/generated/prisma";

const TRANSITIONS: Record<
  ReconciliationWorkflowState,
  readonly ReconciliationWorkflowState[]
> = {
  DRAFT: ["PENDING_CUSTOMER_CONFIRMATION", "CLOSED"],
  PENDING_CUSTOMER_CONFIRMATION: ["CUSTOMER_APPROVED", "DRAFT", "CLOSED"],
  CUSTOMER_APPROVED: ["APPLIED", "PENDING_CUSTOMER_CONFIRMATION", "CLOSED"],
  APPLIED: ["CLOSED"],
  CLOSED: [],
};

export function canTransition(
  from: ReconciliationWorkflowState,
  to: ReconciliationWorkflowState,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: ReconciliationWorkflowState,
  to: ReconciliationWorkflowState,
): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Illegal reconciliation state transition: ${from} → ${to}`,
    );
  }
}
