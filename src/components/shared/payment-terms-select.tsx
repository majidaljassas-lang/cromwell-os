"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Canonical payment-term options. The token strings match the keywords
 * that termsToDays() in /api/sales-invoices/[id]/generate-pdf/route.ts
 * already recognises, so picking from this list flows straight through
 * the existing due-date calculator.
 *
 * "CUSTOM" reveals a free-text input — anything the calculator does not
 * recognise falls back to Net 30.
 */
export const PAYMENT_TERM_OPTIONS = [
  { value: "Pro-Forma", label: "Pro-Forma (paid before delivery)" },
  { value: "On Receipt", label: "On Receipt (due immediately)" },
  { value: "Net 7", label: "Net 7" },
  { value: "Net 14", label: "Net 14" },
  { value: "Net 30", label: "Net 30 (default)" },
  { value: "Net 45", label: "Net 45" },
  { value: "Net 60", label: "Net 60" },
  { value: "Net 90", label: "Net 90" },
  { value: "EOM", label: "EOM (end of current month)" },
  { value: "End of Next Month", label: "End of Next Month (EONM)" },
  { value: "CUSTOM", label: "Custom..." },
] as const;

const KNOWN_VALUES: Set<string> = new Set(
  PAYMENT_TERM_OPTIONS.filter((o) => o.value !== "CUSTOM").map((o) => o.value as string)
);

export function PaymentTermsSelect({
  name,
  defaultValue,
  onChange,
}: {
  name?: string;
  defaultValue: string | null | undefined;
  /** Optional — fires whenever the resolved value changes. Use this when
   *  the parent owns the value (controlled-form pattern); the hidden
   *  <input name=...> is still emitted for FormData-style consumers. */
  onChange?: (value: string) => void;
}) {
  const initial = defaultValue ?? "";
  const startsCustom = initial !== "" && !KNOWN_VALUES.has(initial);
  const [selection, setSelection] = useState<string>(startsCustom ? "CUSTOM" : initial || "Net 30");
  const [customValue, setCustomValue] = useState<string>(startsCustom ? initial : "");

  const submitted = selection === "CUSTOM" ? customValue : selection;

  function handleSelectionChange(v: string) {
    setSelection(v);
    onChange?.(v === "CUSTOM" ? customValue : v);
  }

  function handleCustomChange(v: string) {
    setCustomValue(v);
    if (selection === "CUSTOM") onChange?.(v);
  }

  return (
    <div className="space-y-2">
      <select
        value={selection}
        onChange={(e) => handleSelectionChange(e.target.value)}
        className="w-full h-9 bg-[#222222] border border-[#333333] text-[#E0E0E0] text-sm px-3"
      >
        {PAYMENT_TERM_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {selection === "CUSTOM" && (
        <Input
          value={customValue}
          onChange={(e) => handleCustomChange(e.target.value)}
          placeholder='e.g. "Net 45 from EOM" — free text'
        />
      )}
      {name && <input type="hidden" name={name} value={submitted} />}
    </div>
  );
}
