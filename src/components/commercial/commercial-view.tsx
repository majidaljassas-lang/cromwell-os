"use client";

import { useState, useCallback } from "react";
import { ReconciliationTable } from "./reconciliation-table";
import { ReviewQueues } from "./review-queues";
import { OrderBuilderView } from "./order-builder-view";
import { MediaReview } from "./media-review";
import {
  AlertTriangle,
  RefreshCw,
  ChevronDown,
} from "lucide-react";

interface Site {
  id: string;
  siteName: string;
  siteCode: string | null;
}

interface Props {
  sites: Site[];
  reviewSummary: Record<string, number>;
  siteCaseMap?: Record<string, string>;
}

export function CommercialView({ sites, reviewSummary: initialSummary, siteCaseMap }: Props) {
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [reconciliationData, setReconciliationData] = useState<any>(null);
  const [reviewData, setReviewData] = useState<any>(null);
  const [reviewSummary, setReviewSummary] = useState(initialSummary);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"builder" | "media" | "reconciliation" | "review">("builder");

  const runReconciliation = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/commercial/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: selectedSiteId }),
      });
      const data = await res.json();
      setReconciliationData(data);
    } catch (err) {
      console.error("Reconciliation failed:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId]);

  const loadReviewQueue = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedSiteId) params.set("siteId", selectedSiteId);
      const res = await fetch(`/api/commercial/review-queue?${params}`);
      const data = await res.json();
      setReviewData(data);
      setReviewSummary(data.summary);
    } catch (err) {
      console.error("Failed to load review queue:", err);
    }
  }, [selectedSiteId]);

  const totalReviewItems = Object.values(reviewSummary).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      {/* Site selector + controls */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <select
            value={selectedSiteId}
            onChange={(e) => {
              setSelectedSiteId(e.target.value);
              setReconciliationData(null);
            }}
            className="appearance-none bg-[#1A1A1A] border border-[#333333] text-[#E0E0E0] text-xs px-3 py-2 pr-8 rounded bb-mono focus:border-[#FF6600] focus:outline-none"
          >
            <option value="">SELECT SITE</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.siteName}
                {s.siteCode ? ` [${s.siteCode}]` : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[#666666] pointer-events-none" />
        </div>

        <button
          onClick={runReconciliation}
          disabled={!selectedSiteId || loading}
          className="flex items-center gap-1.5 bg-[#FF6600] text-black text-[10px] font-bold tracking-wider px-3 py-2 rounded bb-mono hover:bg-[#FF7722] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "CALCULATING..." : "RUN RECONCILIATION"}
        </button>

        {totalReviewItems > 0 && (
          <div className="flex items-center gap-1.5 text-[#FF4444] text-[10px] bb-mono">
            <AlertTriangle className="h-3 w-3" />
            {totalReviewItems} REVIEW ITEMS
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[#333333]">
        <button
          onClick={() => setActiveTab("builder")}
          className={`px-4 py-2 text-[10px] font-bold tracking-wider bb-mono border-b-2 transition-colors ${
            activeTab === "builder"
              ? "border-[#FF6600] text-[#FF6600]"
              : "border-transparent text-[#666666] hover:text-[#999999]"
          }`}
        >
          ORDER BUILDER
        </button>
        <button
          onClick={() => setActiveTab("media")}
          className={`px-4 py-2 text-[10px] font-bold tracking-wider bb-mono border-b-2 transition-colors ${
            activeTab === "media"
              ? "border-[#FF6600] text-[#FF6600]"
              : "border-transparent text-[#666666] hover:text-[#999999]"
          }`}
        >
          MEDIA EVIDENCE
        </button>
        <button
          onClick={() => setActiveTab("reconciliation")}
          className={`px-4 py-2 text-[10px] font-bold tracking-wider bb-mono border-b-2 transition-colors ${
            activeTab === "reconciliation"
              ? "border-[#FF6600] text-[#FF6600]"
              : "border-transparent text-[#666666] hover:text-[#999999]"
          }`}
        >
          RECONCILIATION
        </button>
        <button
          onClick={() => {
            setActiveTab("review");
            loadReviewQueue();
          }}
          className={`px-4 py-2 text-[10px] font-bold tracking-wider bb-mono border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "review"
              ? "border-[#FF6600] text-[#FF6600]"
              : "border-transparent text-[#666666] hover:text-[#999999]"
          }`}
        >
          REVIEW QUEUES
          {totalReviewItems > 0 && (
            <span className="bg-[#FF4444] text-black text-[9px] px-1.5 py-0.5 rounded-full font-bold">
              {totalReviewItems}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      {activeTab === "builder" && selectedSiteId && (
        <OrderBuilderView
          siteId={selectedSiteId}
          caseId={siteCaseMap?.[selectedSiteId] || null}
        />
      )}

      {activeTab === "builder" && !selectedSiteId && (
        <div className="text-center py-12 text-[#555555] text-xs bb-mono">
          SELECT A SITE TO BUILD ORDERS
        </div>
      )}

      {activeTab === "media" && selectedSiteId && (
        <MediaReview
          siteId={selectedSiteId}
          caseId={siteCaseMap?.[selectedSiteId] || null}
        />
      )}

      {activeTab === "media" && !selectedSiteId && (
        <div className="text-center py-12 text-[#555555] text-xs bb-mono">
          SELECT A SITE TO REVIEW MEDIA
        </div>
      )}

      {activeTab === "reconciliation" && (
        <>
          {!selectedSiteId && (
            <div className="text-center py-12 text-[#555555] text-xs bb-mono">
              SELECT A SITE TO BEGIN RECONCILIATION
            </div>
          )}
          {selectedSiteId && !reconciliationData && !loading && (
            <div className="text-center py-12 text-[#555555] text-xs bb-mono">
              CLICK &quot;RUN RECONCILIATION&quot; TO CALCULATE
            </div>
          )}
          {reconciliationData && (
            <ReconciliationTable data={reconciliationData} />
          )}
        </>
      )}

      {activeTab === "review" && (
        <ReviewQueues data={reviewData} onResolve={loadReviewQueue} />
      )}
    </div>
  );
}
