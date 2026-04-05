"use client";

import { useState, useCallback } from "react";
import {
  Play,
  ChevronRight,
  ChevronDown,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Scissors,
  Merge,
  ThumbsUp,
  ThumbsDown,
  Ban,
  MapPinOff,
  MessageSquare,
  Image,
  Mic,
  FileText,
  Package,
  Clock,
  Users,
  RotateCcw,
} from "lucide-react";

interface Props {
  siteId: string;
  caseId: string | null;
}

interface OrderGroup {
  id: string;
  label: string;
  description: string | null;
  approvalStatus: string;
  siteConfidence: string;
  contaminationRisk: string;
  orderedQty: number | string;
  sourceChat: string | null;
  primarySender: string | null;
  closureStatus: string;
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
  sourceType: string;
  sourceConfidence: string;
  siteConfidence: string;
  contaminationRisk: string;
  timestamp: string;
  canonicalProduct: { code: string; name: string; category: string | null } | null;
}

const APPROVAL_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
  AUTO_APPROVED: { color: "#00CC66", icon: CheckCircle, label: "AUTO" },
  APPROVED: { color: "#00CC66", icon: CheckCircle, label: "APPROVED" },
  PENDING_REVIEW: { color: "#FFAA00", icon: AlertTriangle, label: "REVIEW" },
  REJECTED: { color: "#FF4444", icon: XCircle, label: "REJECTED" },
  EXCLUDED: { color: "#555555", icon: Ban, label: "EXCLUDED" },
};

const SITE_CONF_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
  CONFIRMED: { color: "#00CC66", icon: ShieldCheck, label: "CONFIRMED" },
  PROBABLE: { color: "#FFAA00", icon: Shield, label: "PROBABLE" },
  UNKNOWN_SITE: { color: "#FF6600", icon: ShieldAlert, label: "UNKNOWN" },
  NOT_THIS_SITE: { color: "#FF4444", icon: ShieldX, label: "NOT DELLOW" },
};

const CONTAM_CONFIG: Record<string, { color: string; label: string }> = {
  LOW_RISK: { color: "#00CC66", label: "LOW" },
  MEDIUM_RISK: { color: "#FFAA00", label: "MED" },
  HIGH_RISK: { color: "#FF4444", label: "HIGH" },
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  INITIAL_ORDER: "#4488FF",
  ADDITION: "#00CC66",
  REDUCTION: "#FF4444",
  SUBSTITUTION_OUT: "#AA66FF",
  SUBSTITUTION_IN: "#AA66FF",
  CANCELLATION: "#FF4444",
  CONFIRMATION: "#00CC66",
  QUERY_ONLY: "#666666",
};

const SOURCE_TYPE_ICONS: Record<string, any> = {
  TEXT_MESSAGE: MessageSquare,
  MEDIA_OCR: Image,
  VOICE_TRANSCRIPT: Mic,
  MEDIA_EXTRACTION: FileText,
  MANUAL_ENTRY: Users,
};

export function OrderBuilderView({ siteId, caseId }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/commercial/order-builder?siteId=${siteId}`);
      setData(await res.json());
    } catch (err) {
      console.error("Load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  const runBuilder = useCallback(async () => {
    if (!caseId) return;
    setBuilding(true);
    try {
      const res = await fetch("/api/commercial/order-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, caseId }),
      });
      const result = await res.json();
      if (result.error) {
        console.error("Build failed:", result.detail);
      }
      await loadData();
    } catch (err) {
      console.error("Build failed:", err);
    } finally {
      setBuilding(false);
    }
  }, [siteId, caseId, loadData]);

  const handleAction = useCallback(async (action: string, groupId: string, extra: Record<string, unknown> = {}) => {
    setActionLoading(groupId);
    try {
      await fetch("/api/commercial/order-builder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, groupId, ...extra }),
      });
      await loadData();
    } catch (err) {
      console.error("Action failed:", err);
    } finally {
      setActionLoading(null);
    }
  }, [loadData]);

  if (!siteId) {
    return <EmptyState text="SELECT A SITE TO BUILD ORDERS" />;
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={runBuilder}
          disabled={building || !caseId}
          className="flex items-center gap-1.5 bg-[#FF6600] text-black text-[10px] font-bold tracking-wider px-3 py-2 rounded bb-mono hover:bg-[#FF7722] disabled:opacity-40"
        >
          <Play className={`h-3 w-3 ${building ? "animate-pulse" : ""}`} />
          {building ? "BUILDING..." : "BUILD ORDERS"}
        </button>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-1.5 bg-[#1A1A1A] border border-[#333333] text-[#E0E0E0] text-[10px] font-bold tracking-wider px-3 py-2 rounded bb-mono hover:border-[#FF6600] disabled:opacity-40"
        >
          <RotateCcw className="h-3 w-3" />
          LOAD EXISTING
        </button>
      </div>

      {/* Summary */}
      {data && (
        <div className="flex gap-4 text-[10px] bb-mono text-[#888888]">
          <span>TOTAL: <span className="text-[#E0E0E0]">{data.total}</span></span>
          <span>APPROVED: <span className="text-[#00CC66]">{data.autoApproved}</span></span>
          <span>REVIEW: <span className="text-[#FFAA00]">{data.needsReview}</span></span>
          <span>EXCLUDED: <span className="text-[#555555]">{data.excluded}</span></span>
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Section A: Auto-approved / Approved */}
          <GroupSection
            title="APPROVED ORDERS"
            titleColor="#00CC66"
            groups={data.sections.approved}
            expandedId={expandedId}
            onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
            onAction={handleAction}
            actionLoading={actionLoading}
          />

          {/* Section B: Needs Review */}
          <GroupSection
            title="NEEDS REVIEW"
            titleColor="#FFAA00"
            groups={data.sections.review}
            expandedId={expandedId}
            onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
            onAction={handleAction}
            actionLoading={actionLoading}
            showWarnings
          />

          {/* Section C: Excluded */}
          {data.sections.excluded.length > 0 && (
            <GroupSection
              title="EXCLUDED / NOT DELLOW"
              titleColor="#555555"
              groups={data.sections.excluded}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
              onAction={handleAction}
              actionLoading={actionLoading}
            />
          )}
        </div>
      )}

      {!data && !loading && <EmptyState text="CLICK BUILD ORDERS OR LOAD EXISTING" />}
    </div>
  );
}

function GroupSection({
  title,
  titleColor,
  groups,
  expandedId,
  onToggle,
  onAction,
  actionLoading,
  showWarnings,
}: {
  title: string;
  titleColor: string;
  groups: OrderGroup[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onAction: (action: string, groupId: string, extra?: Record<string, unknown>) => void;
  actionLoading: string | null;
  showWarnings?: boolean;
}) {
  if (groups.length === 0) return null;

  return (
    <div>
      <div className="text-[9px] font-bold tracking-[0.2em] bb-mono pb-1 mb-2 border-b border-[#333333]" style={{ color: titleColor }}>
        {title} ({groups.length})
      </div>

      <div className="space-y-0.5">
        {groups.map((group) => {
          const isExpanded = expandedId === group.id;
          const approval = APPROVAL_CONFIG[group.approvalStatus] || APPROVAL_CONFIG.PENDING_REVIEW;
          const siteConf = SITE_CONF_CONFIG[group.siteConfidence] || SITE_CONF_CONFIG.UNKNOWN_SITE;
          const contam = CONTAM_CONFIG[group.contaminationRisk] || CONTAM_CONFIG.HIGH_RISK;
          const ApprovalIcon = approval.icon;
          const SiteIcon = siteConf.icon;

          return (
            <div key={group.id}>
              {/* Group header row */}
              <button
                onClick={() => onToggle(group.id)}
                className="w-full grid grid-cols-[2fr_100px_100px_80px_80px_80px_100px] gap-2 text-[11px] text-[#E0E0E0] bb-mono py-2 px-2 hover:bg-[#1A1A1A] transition-colors border-b border-[#1A1A1A] items-center text-left"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown className="h-3 w-3 text-[#FF6600]" /> : <ChevronRight className="h-3 w-3 text-[#555555]" />}
                  <span className="truncate">{group.label}</span>
                </div>
                <span className="text-[#888888] truncate text-[10px]">{group.sourceChat}</span>
                <span className="text-[#888888] truncate text-[10px]">{group.primarySender?.split(" ")[0]}</span>
                <span className="text-right">{group.orderEvents.length}</span>
                <span className="text-right">{Number(group.orderedQty).toLocaleString()}</span>
                <div className="flex items-center gap-1">
                  <SiteIcon className="h-3 w-3" style={{ color: siteConf.color }} />
                  <span className="text-[9px]" style={{ color: siteConf.color }}>{siteConf.label}</span>
                </div>
                <div className="flex items-center gap-1">
                  <ApprovalIcon className="h-3 w-3" style={{ color: approval.color }} />
                  <span className="text-[9px]" style={{ color: approval.color }}>{approval.label}</span>
                  <span className="text-[8px] px-1 rounded" style={{ color: contam.color, backgroundColor: `${contam.color}15` }}>
                    {contam.label}
                  </span>
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="bg-[#111111] border border-[#2A2A2A] rounded mx-2 mb-2 p-3 space-y-3">
                  {/* Description */}
                  {group.description && (
                    <div className="text-[10px] text-[#666666] bb-mono">{group.description}</div>
                  )}

                  {/* Warning banner for review items */}
                  {showWarnings && group.approvalStatus === "PENDING_REVIEW" && (
                    <div className="bg-[#FFAA0010] border border-[#FFAA0030] rounded px-3 py-2">
                      <div className="flex items-center gap-1 text-[9px] font-bold text-[#FFAA00] bb-mono mb-1">
                        <AlertTriangle className="h-3 w-3" /> REVIEW REQUIRED
                      </div>
                      <div className="text-[10px] text-[#CCCCCC] bb-mono space-y-0.5">
                        {group.siteConfidence === "UNKNOWN_SITE" && <div>• Site confidence: UNKNOWN — may not be Dellow Centre</div>}
                        {group.contaminationRisk === "HIGH_RISK" && <div>• Contamination risk: HIGH — from direct chat, not group</div>}
                        {group.contaminationRisk === "MEDIUM_RISK" && <div>• Contamination risk: MEDIUM — verify site attribution</div>}
                      </div>
                    </div>
                  )}

                  {/* Column headers */}
                  <div className="grid grid-cols-[120px_100px_100px_80px_80px_80px_1fr] gap-2 text-[8px] font-bold tracking-wider text-[#555555] bb-mono border-b border-[#2A2A2A] pb-1">
                    <div>DATE</div>
                    <div>TYPE</div>
                    <div>PRODUCT</div>
                    <div className="text-right">QTY</div>
                    <div>UOM</div>
                    <div>SOURCE</div>
                    <div>EVIDENCE</div>
                  </div>

                  {/* Events */}
                  {group.orderEvents.map((event) => {
                    const SourceIcon = SOURCE_TYPE_ICONS[event.sourceType] || MessageSquare;
                    const eventColor = EVENT_TYPE_COLORS[event.eventType] || "#666666";
                    const sConf = SITE_CONF_CONFIG[event.siteConfidence];
                    const SConfIcon = sConf?.icon || ShieldAlert;

                    return (
                      <div key={event.id} className="grid grid-cols-[120px_100px_100px_80px_80px_80px_1fr] gap-2 text-[10px] text-[#CCCCCC] bb-mono py-1 border-b border-[#1A1A1A] items-start">
                        <span className="text-[#888888]">
                          {new Date(event.timestamp).toLocaleDateString("en-GB")}{" "}
                          {new Date(event.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded self-start" style={{ color: eventColor, backgroundColor: `${eventColor}15` }}>
                          {event.eventType.replace(/_/g, " ")}
                        </span>
                        <span className="text-[#4488FF]">
                          {event.canonicalProduct?.code || "UNKNOWN"}
                        </span>
                        <span className="text-right">
                          {Number(event.qty)}
                          {event.uomResolved && event.normalisedQty && (
                            <span className="text-[#00CC66] text-[8px]"> →{Number(event.normalisedQty)}</span>
                          )}
                        </span>
                        <span className="text-[#666666]">
                          {event.rawUom}
                          {!event.uomResolved && <span className="text-[#FF4444]"> ⚠</span>}
                        </span>
                        <span className="flex items-center gap-1">
                          <SourceIcon className="h-3 w-3 text-[#555555]" />
                          <SConfIcon className="h-2.5 w-2.5" style={{ color: sConf?.color || "#666" }} />
                        </span>
                        <span className="text-[#555555] truncate text-[9px]">
                          {event.sourceText || "—"}
                        </span>
                      </div>
                    );
                  })}

                  {/* Approval actions */}
                  <div className="flex items-center gap-2 pt-2 border-t border-[#2A2A2A]">
                    {(group.approvalStatus === "PENDING_REVIEW") && (
                      <>
                        <button
                          onClick={() => onAction("approve", group.id)}
                          disabled={actionLoading === group.id}
                          className="flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-[#00CC6615] text-[#00CC66] hover:bg-[#00CC6630] bb-mono"
                        >
                          <ThumbsUp className="h-3 w-3" /> APPROVE
                        </button>
                        <button
                          onClick={() => onAction("reject", group.id, { reason: "Manual rejection" })}
                          disabled={actionLoading === group.id}
                          className="flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-[#FF444415] text-[#FF4444] hover:bg-[#FF444430] bb-mono"
                        >
                          <ThumbsDown className="h-3 w-3" /> REJECT
                        </button>
                        <button
                          onClick={() => onAction("mark_not_dellow", group.id)}
                          disabled={actionLoading === group.id}
                          className="flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-[#FF444415] text-[#FF4444] hover:bg-[#FF444430] bb-mono"
                        >
                          <MapPinOff className="h-3 w-3" /> NOT DELLOW
                        </button>
                      </>
                    )}
                    {group.approvalStatus !== "EXCLUDED" && group.approvalStatus !== "REJECTED" && (
                      <button
                        onClick={() => onAction("exclude", group.id)}
                        disabled={actionLoading === group.id}
                        className="flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-[#1A1A1A] border border-[#333333] text-[#555555] hover:text-[#FF4444] bb-mono ml-auto"
                      >
                        <Ban className="h-3 w-3" /> EXCLUDE
                      </button>
                    )}
                    {group.orderEvents.length > 1 && (
                      <button
                        onClick={() => onAction("split", group.id, { splitAtEventIndex: 1 })}
                        disabled={actionLoading === group.id}
                        className="flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-[#1A1A1A] border border-[#333333] text-[#888888] hover:text-[#FF6600] bb-mono"
                      >
                        <Scissors className="h-3 w-3" /> SPLIT
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-12 text-[#555555] text-xs bb-mono">
      {text}
    </div>
  );
}
