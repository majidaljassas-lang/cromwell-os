/**
 * Validation Engine
 *
 * Blocks incomplete or unsafe records from entering commercial logic
 * until required fields are resolved. Returns blockers and warnings.
 *
 * A billable line is commercially ready only if:
 * - product/description present
 * - quantity known
 * - EX VAT cost known
 * - VAT basis not UNKNOWN (or explicitly overridden)
 * - classification set
 * - site/customer resolved
 */

export interface ValidationResult {
  isReady: boolean;
  blockers: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidationIssue {
  code: string;
  field: string;
  message: string;
  severity: "BLOCKER" | "WARNING";
}

export function validateBillLine(line: {
  description?: string | null;
  qty?: number | null;
  unitCost?: number | null;
  lineTotal?: number | null;
  costClassification?: string | null;
  sourceAmountBasis?: string | null;
  vatStatus?: string | null;
  amountExVat?: number | null;
  siteId?: string | null;
  customerId?: string | null;
  sourceSiteTextRaw?: string | null;
  sourceCustomerTextRaw?: string | null;
}): ValidationResult {
  const blockers: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Description required
  if (!line.description || line.description.trim().length === 0) {
    blockers.push({
      code: "MISSING_DESCRIPTION",
      field: "description",
      message: "Line description is required",
      severity: "BLOCKER",
    });
  }

  // Quantity required
  if (line.qty == null || line.qty <= 0) {
    blockers.push({
      code: "MISSING_QTY",
      field: "qty",
      message: "Quantity must be greater than zero",
      severity: "BLOCKER",
    });
  }

  // Cost required
  if (line.unitCost == null && line.lineTotal == null) {
    blockers.push({
      code: "MISSING_COST",
      field: "unitCost",
      message: "Unit cost or line total is required",
      severity: "BLOCKER",
    });
  }

  // VAT basis check
  if (line.sourceAmountBasis === "UNKNOWN" || line.vatStatus === "UNKNOWN") {
    blockers.push({
      code: "UNKNOWN_VAT_BASIS",
      field: "sourceAmountBasis",
      message: "VAT basis is unknown — cannot determine EX VAT amount. Manual review required.",
      severity: "BLOCKER",
    });
  }

  // EX VAT amount must exist for commercial readiness
  if (line.amountExVat == null && line.sourceAmountBasis !== "EX_VAT") {
    warnings.push({
      code: "NO_EX_VAT_AMOUNT",
      field: "amountExVat",
      message: "EX VAT amount not calculated yet",
      severity: "WARNING",
    });
  }

  // Classification check
  if (!line.costClassification) {
    warnings.push({
      code: "UNCLASSIFIED",
      field: "costClassification",
      message: "Cost classification not set — defaults to BILLABLE",
      severity: "WARNING",
    });
  }

  // Site resolution
  if (!line.siteId && line.sourceSiteTextRaw) {
    warnings.push({
      code: "UNRESOLVED_SITE",
      field: "siteId",
      message: `Site text "${line.sourceSiteTextRaw}" not resolved to canonical site`,
      severity: "WARNING",
    });
  }

  // Customer resolution
  if (!line.customerId && line.sourceCustomerTextRaw) {
    warnings.push({
      code: "UNRESOLVED_CUSTOMER",
      field: "customerId",
      message: `Customer text "${line.sourceCustomerTextRaw}" not resolved`,
      severity: "WARNING",
    });
  }

  return {
    isReady: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function validateDraftInvoice(draft: {
  customerId?: string | null;
  siteId?: string | null;
  totalValue?: number | null;
  status?: string | null;
  sourceInvoiceJson?: unknown;
}): ValidationResult {
  const blockers: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!draft.customerId) {
    blockers.push({
      code: "MISSING_CUSTOMER",
      field: "customerId",
      message: "Customer not resolved for draft invoice",
      severity: "BLOCKER",
    });
  }

  if (!draft.totalValue || draft.totalValue <= 0) {
    blockers.push({
      code: "MISSING_VALUE",
      field: "totalValue",
      message: "Draft invoice has no value",
      severity: "BLOCKER",
    });
  }

  if (!draft.siteId) {
    warnings.push({
      code: "NO_SITE",
      field: "siteId",
      message: "No site linked to draft invoice",
      severity: "WARNING",
    });
  }

  return {
    isReady: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function validateEnquiryForConversion(enquiry: {
  rawText?: string | null;
  suggestedSiteId?: string | null;
  suggestedCustomerId?: string | null;
  sourceContactId?: string | null;
  status?: string | null;
}): ValidationResult {
  const blockers: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!enquiry.rawText || enquiry.rawText.trim().length === 0) {
    blockers.push({
      code: "EMPTY_ENQUIRY",
      field: "rawText",
      message: "Enquiry has no content",
      severity: "BLOCKER",
    });
  }

  if (!enquiry.suggestedCustomerId) {
    warnings.push({
      code: "NO_CUSTOMER",
      field: "suggestedCustomerId",
      message: "No customer identified for this enquiry",
      severity: "WARNING",
    });
  }

  if (!enquiry.suggestedSiteId) {
    warnings.push({
      code: "NO_SITE",
      field: "suggestedSiteId",
      message: "No site identified — will create as no-site work item",
      severity: "WARNING",
    });
  }

  return {
    isReady: blockers.length === 0,
    blockers,
    warnings,
  };
}
