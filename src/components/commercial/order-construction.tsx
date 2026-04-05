"use client";

import { useState, useCallback } from "react";
import {
  Play,
  Eye,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  CheckCircle,
  Clock,
  Scissors,
  Merge,
  RotateCcw,
  Trash2,
  MessageSquare,
  Package,
  XCircle,
} from "lucide-react";

interface Props {
  siteId: string;
  siteName: string;
}

interface OrderGroup {
  id: string;
  label: string;
  description: string | null;
  orderedQty: number | string;
  fulfilmentStatus: string;
  billingStatus: string;
  closureStatus: string;
  createdAt: string;
  orderEvents: OrderEvent[];
}

interface OrderEvent {
  id: string;
  eventType: string;
  qty: number | string;
  rawUom: string;
  normalisedQty: number | string | null;
  canonicalUom: string | null;
  uomResolved: boolean;
  sourceMessageId: string | null;
  sourceText: string | null;
  timestamp: string;
  canonicalProduct: {
    code: string;
    name: string;
    category: string | null;
  } | null;
}

interface ProposedGroup {
  groupKey: string;
  label: string;
  sender: string;
  events: ProposedEvent[];
  totalOrderedQty: number;
  products: string[];
  firstTimestamp: string;
  lastTimestamp: string;
  confidence: number;
  uncertainReasons: string[];
  isUncertain: boolean;
  sourceMessageIds: string[];
}

interface ProposedEvent {
  messageId: string;
  sender: string;
  timestamp: string;
  rawText: string;
  eventType: string;
  confidence: number;
  reasons: string[];
  productLines: { rawText: string; productCode: string | null; qty: number; rawUom: string; confidence: number }[];
}

const EVENT_TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  INITIAL_ORDER: { color: "#4488FF", label: "INITIAL" },
  ADDITION: { color: "#00CC66", label: "ADDITION" },
  REDUCTION: { color: "#FF4444", label: "REDUCTION" },
  SUBSTITUTION_OUT: { color: "#AA66FF", label: "SUB OUT" },
  SUBSTITUTION_IN: { color: "#AA66FF", label: "SUB IN" },
  CANCELLATION: { color: "#FF4444", label: "CANCEL" },
  CONFIRMATION: { color: "#00CC66", label: "CONFIRM" },
  QUERY_ONLY: { color: "#666666", label: "QUERY" },
};

export function OrderConstruction({ siteId, siteName }: Props) {
  const [mode, setMode] = useState<"preview" | "committed">("preview");
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [committedData, setCommittedData] = useState<any>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const runPreview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/commercial/order-construction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, preview: true }),
      });
      const data = await res.json();
      setPreviewData(data);
      setMode("preview");
    } catch (err) {
      console.error("Preview failed:", err);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  const runCommit = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/commercial/order-construction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, preview: false }),
      });
      const data = await res.json();
      setCommittedData(data);
      setMode("committed");
    } catch (err) {
      console.error("Commit failed:", err);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  const loadCommitted = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/commercial/order-construction?siteId=${siteId}`);
      const data = await res.json();
      setCommittedData(data);
      setMode("committed");
    } catch (err) {
      console.error("Load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  const handleAction = useCallback(async (action: string, payload: Record<string, unknown>) => {
    const key = JSON.stringify(payload);
    setActionLoading(key);
    try {
      await fetch("/api/commercial/order-construction", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      await loadCommitted();
    } catch (err) {
      console.error("Action failed:", err);
    } finally {
      setActionLoading(null);
    }
  }, [loadCommitted]);

  if (!siteId) {
    return (
      <div className="text-center py-12 text-[#555555] text-xs bb-mono">
        SELECT A SITE TO CONSTRUCT ORDERS
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={runPreview}
          disabled={loading}
          className="flex items-center gap-1.5 bg-[#1A1A1A] border border-[#333333] text-[#E0E0E0] text-[10px] font-bold tracking-wider px-3 py-2 rounded bb-mono hover:border-[#FF6600] disabled:opacity-40"
        >
          <Eye className="h-3 w-3" />
          PREVIEW
        </button>
        <button
          onClick={runCommit}
          disabled={loading}
          className="flex items-center gap-1.5 bg-[#FF6600] text-black text-[10px] font-bold tracking-wider px-3 py-2 rounded bb-mono hover:bg-[#FF7722] disabled:opacity-40"
        >
          <Play className="h-3 w-3" />
          {loading ? "CONSTRUCTING..." : "CONSTRUCT ORDERS"}
        </button>
        <button
          onClick={loadCommitted}
          disabled={loading}
          className="flex items-center gap-1.5 bg-[#1A1A1A] border border-[#333333] text-[#E0E0E0] text-[10px] font-bold tracking-wider px-3 py-2 rounded bb-mono hover:border-[#FF6600] disabled:opacity-40"
        >
          <RotateCcw className="h-3 w-3" />
          LOAD EXISTING
        </button>
      </div>

      {/* Stats */}
      {previewData && mode === "preview" && (
        <div className="flex gap-4 text-[10px] bb-mono text-[#888888]">
          <span>MESSAGES SCANNED: <span className="text-[#E0E0E0]">{previewData.totalMessages}</span></span>
          <span>ORDER RELEVANT: <span className="text-[#FF6600]">{previewData.orderRelevant}</span></span>
          <span>PROPOSED GROUPS: <span className="text-[#00CC66]">{previewData.proposedGroups?.length || 0}</span></span>
          <span className="text-[#FFAA00]">PREVIEW MODE — NOT SAVED</span>
        </div>
      )}

      {committedData && mode === "committed" && (
        <div className="flex gap-4 text-[10px] bb-mono text-[#888888]">
          <span>ORDER GROUPS: <span className="text-[#00CC66]">{committedData.groupCount || committedData.groupsCreated}</span></span>
          {committedData.totalMessages && (
            <span>FROM <span className="text-[#E0E0E0]">{committedData.totalMessages}</span> MESSAGES</span>
          )}
          <span className="text-[#00CC66]">COMMITTED</span>
        </div>
      )}

      {/* Preview groups */}
      {mode === "preview" && previewData?.proposedGroups && (
        <PreviewGroups
          groups={previewData.proposedGroups}
          expandedGroup={expandedGroup}
          onToggle={(key) => setExpandedGroup(expandedGroup === key ? null : key)}
        />
      )}

      {/* Committed groups */}
      {mode === "committed" && committedData?.groups && (
        <CommittedGroups
          groups={committedData.groups}
          expandedGroup={expandedGroup}
          onToggle={(id) => setExpandedGroup(expandedGroup === id ? null : id)}
          onAction={handleAction}
          actionLoading={actionLoading}
        />
      )}
    </div>
  );
}

function PreviewGroups({
  groups,
  expandedGroup,
  onToggle,
}: {
  groups: ProposedGroup[];
  expandedGroup: string | null;
  onToggle: (key: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="text-center py-8 text-[#555555] text-xs bb-mono">
        NO ORDER GROUPS DETECTED
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[2fr_100px_120px_80px_80px_100px] gap-2 text-[9px] font-bold tracking-wider text-[#666666] bb-mono border-b border-[#333333] pb-1 px-2">
        <div>GROUP</div>
        <div>SENDER</div>
        <div>DATE RANGE</div>
        <div className="text-right">EVENTS</div>
        <div className="text-right">QTY</div>
        <div className="text-center">CONFIDENCE</div>
      </div>

      {groups.map((group) => {
        const isExpanded = expandedGroup === group.groupKey;
        return (
          <div key={group.groupKey}>
            <button
              onClick={() => onToggle(group.groupKey)}
              className="w-full grid grid-cols-[2fr_100px_120px_80px_80px_100px] gap-2 text-[11px] text-[#E0E0E0] bb-mono py-2 px-2 hover:bg-[#1A1A1A] transition-colors border-b border-[#1A1A1A] items-center text-left"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? <ChevronDown className="h-3 w-3 text-[#FF6600]" /> : <ChevronRight className="h-3 w-3 text-[#555555]" />}
                <div className="flex items-center gap-1.5">
                  {group.isUncertain && <AlertTriangle className="h-3 w-3 text-[#FFAA00] shrink-0" />}
                  <span className="truncate">{group.label}</span>
                </div>
              </div>
              <span className="text-[#888888] truncate">{group.sender.split(" ")[0]}</span>
              <span className="text-[#888888] text-[10px]">
                {new Date(group.firstTimestamp).toLocaleDateString("en-GB")}
                {group.firstTimestamp !== group.lastTimestamp && (
                  <> → {new Date(group.lastTimestamp).toLocaleDateString("en-GB")}</>
                )}
              </span>
              <span className="text-right">{group.events.length}</span>
              <span className="text-right">{group.totalOrderedQty}</span>
              <div className="flex justify-center">
                <ConfidenceBadge value={group.confidence} />
              </div>
            </button>

            {isExpanded && (
              <div className="bg-[#111111] border border-[#2A2A2A] rounded mx-2 mb-2 p-3 space-y-3">
                {/* Uncertain reasons */}
                {group.isUncertain && group.uncertainReasons.length > 0 && (
                  <div className="bg-[#FFAA0010] border border-[#FFAA0030] rounded px-3 py-2">
                    <div className="text-[9px] font-bold tracking-wider text-[#FFAA00] bb-mono mb-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> UNCERTAIN — REVIEW REQUIRED
                    </div>
                    {group.uncertainReasons.map((r, i) => (
                      <div key={i} className="text-[10px] text-[#CCCCCC] bb-mono">• {r}</div>
                    ))}
                  </div>
                )}

                {/* Products summary */}
                {group.products.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {group.products.map((p) => (
                      <span key={p} className="text-[9px] px-2 py-0.5 rounded bg-[#4488FF15] text-[#4488FF] bb-mono">
                        {p}
                      </span>
                    ))}
                  </div>
                )}

                {/* Event timeline */}
                <div className="space-y-2">
                  {group.events.map((event, eventIdx) => (
                    <EventCard key={eventIdx} event={event} showSourceText />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CommittedGroups({
  groups,
  expandedGroup,
  onToggle,
  onAction,
  actionLoading,
}: {
  groups: OrderGroup[];
  expandedGroup: string | null;
  onToggle: (id: string) => void;
  onAction: (action: string, payload: Record<string, unknown>) => void;
  actionLoading: string | null;
}) {
  if (groups.length === 0) {
    return (
      <div className="text-center py-8 text-[#555555] text-xs bb-mono">
        NO ORDER GROUPS CONSTRUCTED YET
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[2fr_80px_80px_120px_100px] gap-2 text-[9px] font-bold tracking-wider text-[#666666] bb-mono border-b border-[#333333] pb-1 px-2">
        <div>GROUP</div>
        <div className="text-right">EVENTS</div>
        <div className="text-right">ORDERED QTY</div>
        <div className="text-center">STATUS</div>
        <div className="text-center">ACTIONS</div>
      </div>

      {groups.map((group) => {
        const isExpanded = expandedGroup === group.id;
        const hasUncertain = group.description?.includes("UNCERTAIN");

        return (
          <div key={group.id}>
            <button
              onClick={() => onToggle(group.id)}
              className="w-full grid grid-cols-[2fr_80px_80px_120px_100px] gap-2 text-[11px] text-[#E0E0E0] bb-mono py-2 px-2 hover:bg-[#1A1A1A] transition-colors border-b border-[#1A1A1A] items-center text-left"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? <ChevronDown className="h-3 w-3 text-[#FF6600]" /> : <ChevronRight className="h-3 w-3 text-[#555555]" />}
                {hasUncertain && <AlertTriangle className="h-3 w-3 text-[#FFAA00] shrink-0" />}
                <span className="truncate">{group.label}</span>
              </div>
              <span className="text-right">{group.orderEvents.length}</span>
              <span className="text-right">{Number(group.orderedQty).toLocaleString()}</span>
              <div className="flex justify-center">
                <span className="text-[9px] px-1.5 py-0.5 rounded text-[#4488FF] bg-[#4488FF15] bb-mono">
                  {group.closureStatus}
                </span>
              </div>
              <div className="flex justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                {group.orderEvents.length > 1 && (
                  <button
                    onClick={() => onAction("split", { groupId: group.id, splitAtEventIndex: 1 })}
                    className="p-1 text-[#888888] hover:text-[#FF6600] transition-colors"
                    title="Split group"
                  >
                    <Scissors className="h-3 w-3" />
                  </button>
                )}
              </div>
            </button>

            {isExpanded && (
              <div className="bg-[#111111] border border-[#2A2A2A] rounded mx-2 mb-2 p-3 space-y-2">
                {group.description && (
                  <div className="text-[10px] text-[#666666] bb-mono">{group.description}</div>
                )}

                {group.orderEvents.map((event) => (
                  <div key={event.id} className="flex items-start gap-2 border-b border-[#1A1A1A] pb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[9px] text-[#888888] bb-mono">
                          {new Date(event.timestamp).toLocaleDateString("en-GB")} {new Date(event.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <EventTypeBadge type={event.eventType} />
                        {event.canonicalProduct && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#4488FF15] text-[#4488FF] bb-mono">
                            {event.canonicalProduct.code}
                          </span>
                        )}
                        <span className="text-[10px] text-[#E0E0E0] bb-mono">
                          {Number(event.qty)} {event.rawUom}
                          {event.uomResolved && event.normalisedQty && (
                            <span className="text-[#00CC66]"> → {Number(event.normalisedQty)} {event.canonicalUom}</span>
                          )}
                          {!event.uomResolved && (
                            <span className="text-[#FF4444]"> ⚠ UOM</span>
                          )}
                        </span>
                      </div>
                      {event.sourceText && (
                        <div className="text-[10px] text-[#555555] bb-mono flex items-start gap-1">
                          <MessageSquare className="h-3 w-3 mt-0.5 shrink-0 text-[#444444]" />
                          <span className="italic">&quot;{event.sourceText}&quot;</span>
                        </div>
                      )}
                      {event.sourceMessageId && (
                        <div className="text-[9px] text-[#333333] bb-mono mt-0.5">
                          MSG: {event.sourceMessageId.slice(0, 12)}…
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => onAction("remove", { eventId: event.id })}
                        className="p-1 text-[#555555] hover:text-[#FF4444] transition-colors"
                        title="Remove event"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EventCard({ event, showSourceText }: { event: ProposedEvent; showSourceText?: boolean }) {
  return (
    <div className="border border-[#2A2A2A] rounded px-3 py-2 space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-[#888888] bb-mono">
          {new Date(event.timestamp).toLocaleDateString("en-GB")} {new Date(event.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <EventTypeBadge type={event.eventType} />
        <ConfidenceBadge value={event.confidence} />
        <span className="text-[10px] text-[#888888] bb-mono">{event.sender}</span>
      </div>

      {/* Reasons */}
      <div className="text-[9px] text-[#555555] bb-mono">
        {event.reasons.join(" · ")}
      </div>

      {/* Product lines */}
      {event.productLines.length > 0 && (
        <div className="space-y-0.5 mt-1">
          {event.productLines.map((pl, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px] bb-mono">
              <Package className="h-3 w-3 text-[#444444] shrink-0" />
              <span className="text-[#E0E0E0]">{pl.qty} {pl.rawUom}</span>
              {pl.productCode ? (
                <span className="text-[#4488FF]">{pl.productCode}</span>
              ) : (
                <span className="text-[#FFAA00]">UNKNOWN</span>
              )}
              <span className="text-[#555555] truncate">{pl.rawText}</span>
            </div>
          ))}
        </div>
      )}

      {/* Source text */}
      {showSourceText && (
        <div className="text-[9px] text-[#444444] bb-mono mt-1 border-t border-[#1A1A1A] pt-1 whitespace-pre-wrap max-h-32 overflow-y-auto">
          {event.rawText.slice(0, 500)}
        </div>
      )}
    </div>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const config = EVENT_TYPE_CONFIG[type] || { color: "#666666", label: type };
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded bb-mono font-bold"
      style={{ color: config.color, backgroundColor: `${config.color}15` }}
    >
      {config.label}
    </span>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const color = value >= 75 ? "#00CC66" : value >= 50 ? "#FFAA00" : "#FF4444";
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded bb-mono"
      style={{ color, backgroundColor: `${color}15` }}
    >
      {value}%
    </span>
  );
}
