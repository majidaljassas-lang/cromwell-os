"use client";

import { useState } from "react";
import type { CleanupInsights } from "@/lib/zoho/cleanup-insights";
import { InsightTiles } from "./InsightTiles";
import { OverviewPanel } from "./OverviewPanel";
import { CustomerLinker } from "./CustomerLinker";
import { SiteLinker } from "./SiteLinker";
import { TriagePanel } from "./TriagePanel";

type Tab = "overview" | "customers" | "sites" | "triage";

export function CleanupView({
  initialInsights,
  initialTab,
}: {
  initialInsights: CleanupInsights;
  initialTab: string;
}) {
  const [tab, setTab] = useState<Tab>(
    (["overview", "customers", "sites", "triage"].includes(initialTab) ? initialTab : "overview") as Tab
  );

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "overview", label: "OVERVIEW" },
    { key: "customers", label: "CUSTOMERS" },
    { key: "sites", label: "SITES" },
    { key: "triage", label: "TRIAGE" },
  ];

  return (
    <div className="space-y-4">
      <InsightTiles insights={initialInsights} />

      <div className="flex gap-1 border-b border-[#333333]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-[10px] uppercase tracking-widest border-b-2 ${
              tab === t.key
                ? "border-[#FF6600] text-[#FF6600] font-bold"
                : "border-transparent text-[#888888] hover:text-[#E0E0E0]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewPanel insights={initialInsights} />}
      {tab === "customers" && <CustomerLinker />}
      {tab === "sites" && <SiteLinker />}
      {tab === "triage" && <TriagePanel insights={initialInsights} />}
    </div>
  );
}
