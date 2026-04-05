"use client";

import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  CheckCircle,
  AlertTriangle,
  Clock,
  XCircle,
  ArrowRightLeft,
  HelpCircle,
} from "lucide-react";

interface ProductRecon {
  canonicalProductId: string;
  productCode: string;
  productName: string;
  category: string | null;
  canonicalUom: string;
  orderedQty: number;
  suppliedQty: number;
  billedQty: number;
  baseQty: number;
  recoverableQty: number;
  sellTotal: number;
  costTotal: number;
  marginTotal: number;
  marginPct: number | null;
  orderGap: number;
  billingGap: number;
  status: string;
  familyStatus: string | null;
  uomValid: boolean;
  allocationComplete: boolean;
  orderCoverageComplete: boolean;
  substitutionEvidenced: boolean;
  invoiceStatus: string | null;
  orderEvents: any[];
  invoiceLines: any[];
  supplyEvents: any[];
  billLineLinks: any[];
}

interface Props {
  data: {
    site: { id: string; name: string };
    calculatedAt: string;
    productCount: number;
    results: ProductRecon[];
  };
}

const STATUS_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  COMPLETE: { icon: CheckCircle, color: "#00CC66", label: "COMPLETE" },
  UNDERBILLED: { icon: AlertTriangle, color: "#FFAA00", label: "UNDERBILLED" },
  OVERBILLED: { icon: XCircle, color: "#FF4444", label: "OVERBILLED" },
  OVER_SUPPLIED: { icon: AlertTriangle, color: "#FF6600", label: "OVER SUPPLIED" },
  OVER_SUPPLIED_UNDERBILLED: { icon: AlertTriangle, color: "#FF4444", label: "OVER SUP + UNDERBILLED" },
  AWAITING_INVOICE: { icon: Clock, color: "#4488FF", label: "AWAITING INV" },
  SATISFIED_BY_SUBSTITUTION: { icon: ArrowRightLeft, color: "#AA66FF", label: "SUBSTITUTED" },
  REVIEW_REQUIRED_RECON: { icon: HelpCircle, color: "#FF6600", label: "REVIEW REQ" },
};

const INVOICE_STATUS_COLORS: Record<string, string> = {
  DRAFT: "#666666",
  SENT: "#4488FF",
  OVERDUE: "#FF4444",
  PAID: "#00CC66",
  PART_PAID: "#FFAA00",
  VOID: "#FF4444",
};

function formatCurrency(v: number): string {
  return `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQty(v: number, uom: string): string {
  return `${v.toLocaleString("en-GB", { maximumFractionDigits: 2 })} ${uom}`;
}

function formatPct(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(1)}%`;
}

export function ReconciliationTable({ data }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (data.results.length === 0) {
    return (
      <div className="text-center py-12 text-[#555555] text-xs bb-mono">
        NO COMMERCIAL DATA FOUND FOR THIS SITE
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Summary header */}
      <div className="flex items-center justify-between text-[10px] text-[#666666] bb-mono px-1">
        <span>{data.site.name} — {data.productCount} PRODUCTS</span>
        <span>CALCULATED {new Date(data.calculatedAt).toLocaleString("en-GB")}</span>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-0 text-[9px] font-bold tracking-wider text-[#666666] bb-mono border-b border-[#333333] pb-1 px-2">
        <div>PRODUCT</div>
        <div className="text-right">ORDERED</div>
        <div className="text-right">SUPPLIED</div>
        <div className="text-right">BILLED</div>
        <div className="text-right">BASE QTY</div>
        <div className="text-right">RECOVERABLE</div>
        <div className="text-right">SELL £</div>
        <div className="text-right">COST £</div>
        <div className="text-right">MARGIN £</div>
        <div className="text-center">STATUS</div>
        <div className="text-center">INV STATUS</div>
        <div></div>
      </div>

      {/* Product rows */}
      {data.results.map((product) => {
        const isExpanded = expandedId === product.canonicalProductId;
        const sc = STATUS_CONFIG[product.status] || STATUS_CONFIG.REVIEW_REQUIRED_RECON;
        const StatusIcon = sc.icon;

        return (
          <div key={product.canonicalProductId}>
            {/* Main row */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : product.canonicalProductId)}
              className="w-full grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-0 text-[11px] text-[#E0E0E0] bb-mono py-2 px-2 hover:bg-[#1A1A1A] transition-colors border-b border-[#1A1A1A] items-center text-left"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-[#FF6600] shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-[#555555] shrink-0" />
                )}
                <div>
                  <div className="font-medium">{product.productCode}</div>
                  <div className="text-[9px] text-[#666666]">{product.productName}</div>
                </div>
              </div>
              <div className="text-right">{formatQty(product.orderedQty, product.canonicalUom)}</div>
              <div className="text-right">{formatQty(product.suppliedQty, product.canonicalUom)}</div>
              <div className="text-right">{formatQty(product.billedQty, product.canonicalUom)}</div>
              <div className="text-right font-medium">{formatQty(product.baseQty, product.canonicalUom)}</div>
              <div className="text-right" style={{ color: product.recoverableQty > 0 ? "#FF6600" : "#00CC66" }}>
                {product.recoverableQty > 0 ? formatQty(product.recoverableQty, product.canonicalUom) : "—"}
              </div>
              <div className="text-right">{formatCurrency(product.sellTotal)}</div>
              <div className="text-right">{product.costTotal > 0 ? formatCurrency(product.costTotal) : "—"}</div>
              <div className="text-right" style={{ color: product.marginTotal < 0 ? "#FF4444" : "#E0E0E0" }}>
                {product.costTotal > 0 ? formatCurrency(product.marginTotal) : "—"}
              </div>
              <div className="flex justify-center">
                <span
                  className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded"
                  style={{ color: sc.color, backgroundColor: `${sc.color}15` }}
                >
                  <StatusIcon className="h-2.5 w-2.5" />
                  {sc.label}
                </span>
              </div>
              <div className="flex justify-center">
                {product.invoiceStatus ? (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{
                      color: INVOICE_STATUS_COLORS[product.invoiceStatus] || "#666666",
                      backgroundColor: `${INVOICE_STATUS_COLORS[product.invoiceStatus] || "#666666"}15`,
                    }}
                  >
                    {product.invoiceStatus}
                  </span>
                ) : (
                  <span className="text-[9px] text-[#555555]">—</span>
                )}
              </div>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <ExpandedDetail product={product} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ExpandedDetail({ product }: { product: ProductRecon }) {
  return (
    <div className="bg-[#111111] border border-[#2A2A2A] rounded mx-2 mb-2 p-4 space-y-4">
      {/* Validation flags */}
      <div className="flex flex-wrap gap-3 text-[9px] bb-mono">
        <Flag label="UOM VALID" ok={product.uomValid} />
        <Flag label="ORDER COVERAGE" ok={product.orderCoverageComplete} />
        <Flag label="ALLOCATION" ok={product.allocationComplete} />
        <Flag label="SUBSTITUTION EVIDENCED" ok={product.substitutionEvidenced} />
        <span className="text-[#888888]">BASE: {product.baseQty}</span>
        {product.recoverableQty > 0 && (
          <span className="text-[#FF6600] font-bold">
            RECOVERABLE: {product.recoverableQty}
          </span>
        )}
        {product.orderGap !== 0 && (
          <span className={product.orderGap > 0 ? "text-[#FF6600]" : "text-[#FFAA00]"}>
            {product.orderGap > 0 ? "OVER-SUPPLIED" : "UNDER-SUPPLIED"}: {product.orderGap > 0 ? "+" : ""}{product.orderGap}
          </span>
        )}
        {product.billingGap !== 0 && (
          <span className={product.billingGap > 0 ? "text-[#FF6600]" : "text-[#00CC66]"}>
            {product.billingGap > 0 ? "UNDERBILLED" : "OVERBILLED"}: {product.billingGap > 0 ? "+" : ""}{product.billingGap}
          </span>
        )}
      </div>

      {/* Order Events Timeline */}
      {product.orderEvents.length > 0 && (
        <Section title="ORDER EVENTS">
          <div className="space-y-1">
            {product.orderEvents.map((oe) => (
              <div key={oe.id} className="grid grid-cols-[120px_120px_80px_80px_1fr] gap-2 text-[10px] text-[#CCCCCC] bb-mono py-1 border-b border-[#1A1A1A]">
                <span className="text-[#888888]">
                  {new Date(oe.timestamp).toLocaleDateString("en-GB")}
                </span>
                <EventTypeBadge type={oe.eventType} />
                <span className="text-right">
                  {oe.normalisedQty !== null ? oe.normalisedQty : oe.qty}
                </span>
                <span className="text-[#666666]">
                  {oe.uomResolved ? product.canonicalUom : (
                    <span className="text-[#FF4444]">{oe.rawUom} ⚠</span>
                  )}
                </span>
                <span className="text-[#555555] truncate">
                  {oe.orderGroupLabel}
                  {oe.sourceText && <> — {oe.sourceText}</>}
                  {oe.sourceMessageId && (
                    <span className="text-[#4488FF] ml-1">[MSG]</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Supply Events */}
      {product.supplyEvents.length > 0 && (
        <Section title="SUPPLY / FULFILMENT">
          <div className="space-y-1">
            {product.supplyEvents.map((se) => (
              <div key={se.id} className="grid grid-cols-[120px_120px_80px_80px_1fr] gap-2 text-[10px] text-[#CCCCCC] bb-mono py-1 border-b border-[#1A1A1A]">
                <span className="text-[#888888]">
                  {new Date(se.timestamp).toLocaleDateString("en-GB")}
                </span>
                <FulfilmentBadge type={se.fulfilmentType} />
                <span className="text-right">
                  {se.normalisedQty !== null ? se.normalisedQty : se.qty}
                </span>
                <span className="text-[#666666]">
                  {se.uomResolved ? product.canonicalUom : (
                    <span className="text-[#FF4444]">{se.rawUom} ⚠</span>
                  )}
                </span>
                <span className="text-[#555555] truncate">
                  {se.sourceRef && <span className="text-[#4488FF]">[{se.sourceRef}]</span>}
                  {se.evidenceRef && <span className="text-[#00CC66] ml-1">[EVIDENCE]</span>}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Invoice Lines */}
      {product.invoiceLines.length > 0 && (
        <Section title="INVOICE LINES">
          <div className="space-y-1">
            {product.invoiceLines.map((il) => (
              <div key={il.id} className="grid grid-cols-[100px_80px_1fr_80px_80px_100px_120px] gap-2 text-[10px] text-[#CCCCCC] bb-mono py-1 border-b border-[#1A1A1A]">
                <span className="text-[#4488FF]">{il.invoiceNumber}</span>
                <span
                  className="text-center text-[9px] px-1 rounded"
                  style={{
                    color: INVOICE_STATUS_COLORS[il.invoiceStatus] || "#666666",
                    backgroundColor: `${INVOICE_STATUS_COLORS[il.invoiceStatus] || "#666666"}15`,
                  }}
                >
                  {il.invoiceStatus}
                </span>
                <span className="truncate text-[#888888]">{il.description}</span>
                <span className="text-right">{il.qty} {il.rawUom}</span>
                <span className="text-right">
                  {il.sellAmount !== null ? formatCurrency(il.sellAmount) : "—"}
                </span>
                <AllocationBadge status={il.allocationStatus} />
                <span className="text-[#555555] truncate text-[9px]">
                  {il.allocatedOrderGroupLabel || "UNLINKED"}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Bill Line Links (Cost / Margin) */}
      {product.billLineLinks.length > 0 && (
        <Section title="SUPPLIER / COST">
          <div className="space-y-1">
            {product.billLineLinks.map((bl) => (
              <div key={bl.id} className="grid grid-cols-[100px_120px_1fr_80px_80px_80px_100px] gap-2 text-[10px] text-[#CCCCCC] bb-mono py-1 border-b border-[#1A1A1A]">
                <span className="text-[#AA66FF]">{bl.billNumber}</span>
                <span className="text-[#888888] truncate">{bl.supplierName || "—"}</span>
                <span className="truncate text-[#888888]">{bl.description}</span>
                <span className="text-right">{bl.costRate !== null ? formatCurrency(bl.costRate) : "—"}</span>
                <span className="text-right">{bl.costAmount !== null ? formatCurrency(bl.costAmount) : "—"}</span>
                <span className="text-right" style={{ color: bl.marginAmount !== null && bl.marginAmount < 0 ? "#FF4444" : "#00CC66" }}>
                  {bl.marginAmount !== null ? formatCurrency(bl.marginAmount) : "—"}
                </span>
                <CostLinkBadge status={bl.costLinkStatus} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Empty states */}
      {product.orderEvents.length === 0 && product.invoiceLines.length === 0 && product.supplyEvents.length === 0 && (
        <div className="text-center py-4 text-[#555555] text-[10px] bb-mono">
          NO DETAIL DATA AVAILABLE
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-bold tracking-wider text-[#666666] bb-mono border-b border-[#2A2A2A] pb-1 mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function Flag({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`flex items-center gap-1 ${ok ? "text-[#00CC66]" : "text-[#FF4444]"}`}>
      {ok ? <CheckCircle className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    INITIAL_ORDER: "#4488FF",
    ADDITION: "#00CC66",
    REDUCTION: "#FF4444",
    SUBSTITUTION_OUT: "#AA66FF",
    SUBSTITUTION_IN: "#AA66FF",
    CANCELLATION: "#FF4444",
    CONFIRMATION: "#00CC66",
    QUERY_ONLY: "#666666",
  };
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ color: colors[type] || "#666666", backgroundColor: `${colors[type] || "#666666"}15` }}>
      {type.replace(/_/g, " ")}
    </span>
  );
}

function FulfilmentBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    DELIVERED: "#00CC66",
    PART_DELIVERED: "#FFAA00",
    SUBSTITUTED: "#AA66FF",
    RETURNED: "#FF4444",
    CREDITED: "#4488FF",
  };
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ color: colors[type] || "#666666", backgroundColor: `${colors[type] || "#666666"}15` }}>
      {type.replace(/_/g, " ")}
    </span>
  );
}

function AllocationBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    UNALLOCATED: "#FF4444",
    PARTIALLY_ALLOCATED: "#FFAA00",
    ALLOCATED: "#00CC66",
  };
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded text-center" style={{ color: colors[status] || "#666666", backgroundColor: `${colors[status] || "#666666"}15` }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function CostLinkBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    NO_COST_LINKED: "#FF4444",
    PARTIALLY_LINKED: "#FFAA00",
    FULLY_LINKED: "#00CC66",
    NEGATIVE_MARGIN: "#FF4444",
    LOW_MARGIN: "#FFAA00",
  };
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded text-center" style={{ color: colors[status] || "#666666", backgroundColor: `${colors[status] || "#666666"}15` }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
