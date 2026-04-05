"use client";

import { useState, useCallback } from "react";
import {
  Image,
  FileText,
  Mic,
  Video,
  File,
  Search,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Link2,
  Eye,
  Tag,
  Package,
  AlertTriangle,
} from "lucide-react";

interface Props {
  siteId: string;
  caseId: string | null;
}

interface MediaItem {
  id: string;
  sourceChat: string | null;
  sender: string | null;
  timestamp: string;
  mediaType: string;
  fileName: string | null;
  rawText: string | null;
  extractedText: string | null;
  processingStatus: string;
  evidenceRole: string;
  roleConfidence: string;
  classificationNotes: string | null;
  candidateProducts: string[];
  candidateQtys: Record<string, number> | null;
  orderGroupId: string | null;
}

const MEDIA_ICON: Record<string, any> = {
  IMAGE: Image,
  PDF: FileText,
  DOCUMENT: File,
  VOICE_NOTE: Mic,
  VIDEO: Video,
};

const ROLE_CONFIG: Record<string, { color: string; label: string }> = {
  ORDER_EVIDENCE: { color: "#4488FF", label: "ORDER" },
  DELIVERY_EVIDENCE: { color: "#00CC66", label: "DELIVERY" },
  INVOICE_EVIDENCE: { color: "#FFAA00", label: "INVOICE" },
  PRODUCT_REFERENCE: { color: "#AA66FF", label: "PRODUCT REF" },
  IRRELEVANT: { color: "#555555", label: "IRRELEVANT" },
  UNKNOWN_MEDIA: { color: "#FF6600", label: "UNKNOWN" },
};

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  PENDING: { color: "#FF6600", label: "PENDING" },
  EXTRACTING: { color: "#FFAA00", label: "EXTRACTING" },
  EXTRACTED: { color: "#4488FF", label: "EXTRACTED" },
  CLASSIFIED: { color: "#00CC66", label: "CLASSIFIED" },
  LINKED: { color: "#00CC66", label: "LINKED" },
  FAILED: { color: "#FF4444", label: "FAILED" },
  EXCLUDED: { color: "#555555", label: "EXCLUDED" },
};

const CONFIDENCE_CONFIG: Record<string, { color: string }> = {
  HIGH: { color: "#00CC66" },
  MEDIUM: { color: "#FFAA00" },
  LOW: { color: "#FF4444" },
};

export function MediaReview({ siteId, caseId }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterRole, setFilterRole] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadMedia = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ siteId });
      if (filterStatus) params.set("status", filterStatus);
      if (filterRole) params.set("role", filterRole);
      const res = await fetch(`/api/commercial/media?${params}`);
      const result = await res.json();
      setData(result);
    } catch (err) {
      console.error("Load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [siteId, filterStatus, filterRole]);

  const scanMedia = useCallback(async () => {
    if (!caseId) return;
    setScanning(true);
    try {
      const res = await fetch("/api/commercial/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, caseId }),
      });
      const result = await res.json();
      console.log("Scan result:", result);
      await loadMedia();
    } catch (err) {
      console.error("Scan failed:", err);
    } finally {
      setScanning(false);
    }
  }, [siteId, caseId, loadMedia]);

  const handleAction = useCallback(async (id: string, action: string, extra: Record<string, unknown> = {}) => {
    setActionLoading(id);
    try {
      await fetch("/api/commercial/media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...extra }),
      });
      await loadMedia();
    } catch (err) {
      console.error("Action failed:", err);
    } finally {
      setActionLoading(null);
    }
  }, [loadMedia]);

  if (!siteId) {
    return (
      <div className="text-center py-12 text-[#555555] text-xs bb-mono">
        SELECT A SITE TO REVIEW MEDIA
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={scanMedia}
          disabled={scanning || !caseId}
          className="flex items-center gap-1.5 bg-[#FF6600] text-black text-[10px] font-bold tracking-wider px-3 py-2 rounded bb-mono hover:bg-[#FF7722] disabled:opacity-40"
        >
          <Search className={`h-3 w-3 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "SCANNING..." : "SCAN FOR MEDIA"}
        </button>
        <button
          onClick={loadMedia}
          disabled={loading}
          className="flex items-center gap-1.5 bg-[#1A1A1A] border border-[#333333] text-[#E0E0E0] text-[10px] font-bold tracking-wider px-3 py-2 rounded bb-mono hover:border-[#FF6600] disabled:opacity-40"
        >
          LOAD MEDIA
        </button>

        {/* Filters */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-[#1A1A1A] border border-[#333333] text-[#E0E0E0] text-[10px] px-2 py-1.5 rounded bb-mono"
        >
          <option value="">ALL STATUS</option>
          <option value="PENDING">PENDING</option>
          <option value="EXTRACTED">EXTRACTED</option>
          <option value="CLASSIFIED">CLASSIFIED</option>
          <option value="LINKED">LINKED</option>
          <option value="EXCLUDED">EXCLUDED</option>
        </select>

        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="bg-[#1A1A1A] border border-[#333333] text-[#E0E0E0] text-[10px] px-2 py-1.5 rounded bb-mono"
        >
          <option value="">ALL ROLES</option>
          <option value="ORDER_EVIDENCE">ORDER</option>
          <option value="DELIVERY_EVIDENCE">DELIVERY</option>
          <option value="INVOICE_EVIDENCE">INVOICE</option>
          <option value="PRODUCT_REFERENCE">PRODUCT REF</option>
          <option value="UNKNOWN_MEDIA">UNKNOWN</option>
          <option value="IRRELEVANT">IRRELEVANT</option>
        </select>
      </div>

      {/* Summary */}
      {data && (
        <div className="flex flex-wrap gap-4 text-[10px] bb-mono text-[#888888]">
          <span>TOTAL: <span className="text-[#E0E0E0]">{data.total}</span></span>
          {Object.entries(data.byType as Record<string, number>).map(([type, count]) => {
            const Icon = MEDIA_ICON[type] || File;
            return (
              <span key={type} className="flex items-center gap-1">
                <Icon className="h-3 w-3" />
                {type}: <span className="text-[#E0E0E0]">{count}</span>
              </span>
            );
          })}
          {data.completeness && (
            <span className={data.completeness.isComplete ? "text-[#00CC66]" : "text-[#FF4444]"}>
              {data.completeness.isComplete ? "BACKLOG COMPLETE" : `MEDIA PENDING: ${data.completeness.totalMedia - data.completeness.mediaProcessed - data.completeness.mediaExcluded}`}
            </span>
          )}
        </div>
      )}

      {/* Completeness warning */}
      {data?.completeness && !data.completeness.isComplete && (
        <div className="bg-[#FF444415] border border-[#FF444430] rounded px-3 py-2 flex items-center gap-2 text-[10px] text-[#FF4444] bb-mono">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          BACKLOG INCOMPLETE — {data.completeness.totalMedia - data.completeness.mediaProcessed - data.completeness.mediaExcluded} media items not yet processed or excluded. Reconciliation should not be treated as final.
        </div>
      )}

      {/* Media items */}
      {data?.items && data.items.length > 0 ? (
        <div className="space-y-1">
          <div className="grid grid-cols-[40px_120px_120px_1fr_100px_100px_80px_120px] gap-2 text-[9px] font-bold tracking-wider text-[#666666] bb-mono border-b border-[#333333] pb-1 px-2">
            <div />
            <div>DATE</div>
            <div>SENDER</div>
            <div>CONTEXT</div>
            <div className="text-center">TYPE</div>
            <div className="text-center">ROLE</div>
            <div className="text-center">CONFIDENCE</div>
            <div className="text-center">STATUS</div>
          </div>

          {(data.items as MediaItem[]).map((item) => {
            const isExpanded = expandedId === item.id;
            const Icon = MEDIA_ICON[item.mediaType] || File;
            const role = ROLE_CONFIG[item.evidenceRole] || ROLE_CONFIG.UNKNOWN_MEDIA;
            const status = STATUS_CONFIG[item.processingStatus] || STATUS_CONFIG.PENDING;
            const conf = CONFIDENCE_CONFIG[item.roleConfidence] || CONFIDENCE_CONFIG.LOW;

            return (
              <div key={item.id}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="w-full grid grid-cols-[40px_120px_120px_1fr_100px_100px_80px_120px] gap-2 text-[11px] text-[#E0E0E0] bb-mono py-2 px-2 hover:bg-[#1A1A1A] transition-colors border-b border-[#1A1A1A] items-center text-left"
                >
                  <div className="flex items-center">
                    {isExpanded ? <ChevronDown className="h-3 w-3 text-[#FF6600]" /> : <ChevronRight className="h-3 w-3 text-[#555555]" />}
                  </div>
                  <span className="text-[#888888] text-[10px]">
                    {new Date(item.timestamp).toLocaleDateString("en-GB")}
                  </span>
                  <span className="text-[#888888] truncate text-[10px]">{item.sender || "—"}</span>
                  <span className="text-[#666666] truncate text-[10px]">
                    {item.fileName || item.rawText?.slice(0, 60) || "—"}
                  </span>
                  <div className="flex justify-center">
                    <span className="flex items-center gap-1 text-[9px] text-[#888888]">
                      <Icon className="h-3 w-3" />
                      {item.mediaType}
                    </span>
                  </div>
                  <div className="flex justify-center">
                    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ color: role.color, backgroundColor: `${role.color}15` }}>
                      {role.label}
                    </span>
                  </div>
                  <div className="flex justify-center">
                    <span className="text-[9px]" style={{ color: conf.color }}>{item.roleConfidence}</span>
                  </div>
                  <div className="flex justify-center">
                    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ color: status.color, backgroundColor: `${status.color}15` }}>
                      {status.label}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="bg-[#111111] border border-[#2A2A2A] rounded mx-2 mb-2 p-3 space-y-3">
                    {/* Classification notes */}
                    {item.classificationNotes && (
                      <div className="text-[10px] text-[#888888] bb-mono">
                        Classification: {item.classificationNotes}
                      </div>
                    )}

                    {/* Raw message context */}
                    {item.rawText && (
                      <div>
                        <div className="text-[9px] font-bold tracking-wider text-[#666666] bb-mono mb-1">MESSAGE CONTEXT</div>
                        <div className="text-[10px] text-[#CCCCCC] bb-mono whitespace-pre-wrap bg-[#0D0D0D] rounded p-2 max-h-32 overflow-y-auto">
                          {item.rawText.slice(0, 500)}
                        </div>
                      </div>
                    )}

                    {/* Extracted text */}
                    {item.extractedText && (
                      <div>
                        <div className="text-[9px] font-bold tracking-wider text-[#666666] bb-mono mb-1">EXTRACTED TEXT</div>
                        <div className="text-[10px] text-[#E0E0E0] bb-mono whitespace-pre-wrap bg-[#0D0D0D] rounded p-2 max-h-32 overflow-y-auto">
                          {item.extractedText}
                        </div>
                      </div>
                    )}

                    {/* Candidate products */}
                    {item.candidateProducts.length > 0 && (
                      <div>
                        <div className="text-[9px] font-bold tracking-wider text-[#666666] bb-mono mb-1">CANDIDATE PRODUCTS</div>
                        <div className="flex flex-wrap gap-1.5">
                          {item.candidateProducts.map((p) => (
                            <span key={p} className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded bg-[#4488FF15] text-[#4488FF] bb-mono">
                              <Package className="h-2.5 w-2.5" />
                              {p}
                              {item.candidateQtys && item.candidateQtys[p] && (
                                <span className="text-[#888888]">× {item.candidateQtys[p]}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1 border-t border-[#2A2A2A]">
                      {/* Classify buttons */}
                      {item.processingStatus === "PENDING" && (
                        <>
                          {["ORDER_EVIDENCE", "DELIVERY_EVIDENCE", "INVOICE_EVIDENCE", "PRODUCT_REFERENCE", "IRRELEVANT"].map((role) => (
                            <button
                              key={role}
                              onClick={() => handleAction(item.id, "classify", { evidenceRole: role, confidence: "MEDIUM" })}
                              disabled={actionLoading === item.id}
                              className="text-[9px] px-2 py-1 rounded bg-[#1A1A1A] border border-[#333333] text-[#888888] hover:text-[#FF6600] hover:border-[#FF6600] transition-colors bb-mono"
                            >
                              {ROLE_CONFIG[role]?.label || role}
                            </button>
                          ))}
                        </>
                      )}

                      {/* Exclude */}
                      {item.processingStatus !== "EXCLUDED" && item.processingStatus !== "LINKED" && (
                        <button
                          onClick={() => handleAction(item.id, "exclude")}
                          disabled={actionLoading === item.id}
                          className="flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-[#1A1A1A] border border-[#333333] text-[#555555] hover:text-[#FF4444] hover:border-[#FF4444] transition-colors bb-mono ml-auto"
                        >
                          <XCircle className="h-3 w-3" />
                          EXCLUDE
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : data ? (
        <div className="text-center py-8 text-[#555555] text-xs bb-mono">
          NO MEDIA FOUND — RUN SCAN TO DETECT
        </div>
      ) : null}
    </div>
  );
}
