"use client";

import { useState } from "react";
import {
  MapPin,
  Package,
  Scale,
  Link2Off,
  FileQuestion,
  CheckCircle,
  X,
} from "lucide-react";

interface ReviewItem {
  id: string;
  queueType: string;
  status: string;
  siteId: string | null;
  productCode: string | null;
  entityId: string | null;
  entityType: string | null;
  description: string;
  rawValue: string | null;
  resolvedValue: string | null;
  createdAt: string;
}

interface Props {
  data: { items: ReviewItem[]; summary: Record<string, number> } | null;
  onResolve: () => void;
}

const QUEUE_CONFIG: Record<string, { icon: any; label: string; color: string }> = {
  UNRESOLVED_SITE: { icon: MapPin, label: "Unresolved Sites", color: "#FF6600" },
  UNRESOLVED_PRODUCT: { icon: Package, label: "Unresolved Products", color: "#FFAA00" },
  UOM_MISMATCH: { icon: Scale, label: "UOM Mismatch", color: "#FF4444" },
  UNALLOCATED_INVOICE_LINE: { icon: Link2Off, label: "Unallocated Invoice Lines", color: "#4488FF" },
  MISSING_ORDER_EVIDENCE: { icon: FileQuestion, label: "Missing Order Evidence", color: "#AA66FF" },
  SUBSTITUTION_NO_EVIDENCE: { icon: FileQuestion, label: "Substitution (No Evidence)", color: "#AA66FF" },
  NEGATIVE_MARGIN_REVIEW: { icon: Scale, label: "Negative Margin", color: "#FF4444" },
  MEDIA_PENDING: { icon: FileQuestion, label: "Media Pending", color: "#FF6600" },
};

export function ReviewQueues({ data, onResolve }: Props) {
  const [activeQueue, setActiveQueue] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  if (!data) {
    return (
      <div className="text-center py-12 text-[#555555] text-xs bb-mono">
        LOADING REVIEW QUEUE...
      </div>
    );
  }

  const { items, summary } = data;
  const queueTypes = Object.keys(QUEUE_CONFIG);
  const filteredItems = activeQueue
    ? items.filter((i) => i.queueType === activeQueue)
    : items;

  const handleResolve = async (id: string) => {
    setResolving(id);
    try {
      await fetch("/api/commercial/review-queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "RESOLVED" }),
      });
      onResolve();
    } catch (err) {
      console.error("Failed to resolve:", err);
    } finally {
      setResolving(null);
    }
  };

  const handleDismiss = async (id: string) => {
    setResolving(id);
    try {
      await fetch("/api/commercial/review-queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "DISMISSED" }),
      });
      onResolve();
    } catch (err) {
      console.error("Failed to dismiss:", err);
    } finally {
      setResolving(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Queue type filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveQueue(null)}
          className={`text-[10px] px-3 py-1.5 rounded bb-mono font-bold tracking-wider transition-colors ${
            activeQueue === null
              ? "bg-[#FF6600] text-black"
              : "bg-[#1A1A1A] text-[#888888] hover:text-[#FF6600]"
          }`}
        >
          ALL ({items.length})
        </button>
        {queueTypes.map((qt) => {
          const config = QUEUE_CONFIG[qt];
          const count = summary[qt] || 0;
          if (count === 0) return null;
          const Icon = config.icon;
          return (
            <button
              key={qt}
              onClick={() => setActiveQueue(qt)}
              className={`flex items-center gap-1.5 text-[10px] px-3 py-1.5 rounded bb-mono font-bold tracking-wider transition-colors ${
                activeQueue === qt
                  ? "text-black"
                  : "bg-[#1A1A1A] text-[#888888] hover:text-[#FF6600]"
              }`}
              style={activeQueue === qt ? { backgroundColor: config.color } : {}}
            >
              <Icon className="h-3 w-3" />
              {config.label.toUpperCase()} ({count})
            </button>
          );
        })}
      </div>

      {/* Items */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-8 text-[#555555] text-xs bb-mono">
          NO ITEMS IN QUEUE
        </div>
      ) : (
        <div className="space-y-1">
          {filteredItems.map((item) => {
            const config = QUEUE_CONFIG[item.queueType] || { icon: FileQuestion, label: item.queueType, color: "#666666" };
            const Icon = config.icon;
            return (
              <div
                key={item.id}
                className="flex items-start gap-3 bg-[#111111] border border-[#2A2A2A] rounded px-3 py-2"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: config.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-[#CCCCCC] bb-mono">{item.description}</div>
                  <div className="flex gap-3 mt-1 text-[9px] text-[#555555] bb-mono">
                    {item.productCode && <span>PRODUCT: {item.productCode}</span>}
                    {item.rawValue && <span>RAW: &quot;{item.rawValue}&quot;</span>}
                    <span>{new Date(item.createdAt).toLocaleDateString("en-GB")}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleResolve(item.id)}
                    disabled={resolving === item.id}
                    className="p-1 text-[#00CC66] hover:bg-[#00CC6615] rounded transition-colors"
                    title="Resolve"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDismiss(item.id)}
                    disabled={resolving === item.id}
                    className="p-1 text-[#666666] hover:bg-[#FF444415] hover:text-[#FF4444] rounded transition-colors"
                    title="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
