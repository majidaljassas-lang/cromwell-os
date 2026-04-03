"use client";

import { useState } from "react";

export function DownloadPdfButton({ quoteId, pdfPath }: { quoteId: string; pdfPath: string | null }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);

    if (pdfPath) {
      // PDF already exists — download it
      window.open(`/api/quotes/${quoteId}/generate-pdf`, "_blank");
      return;
    }

    // Generate PDF first, then download
    setGenerating(true);
    try {
      const res = await fetch(`/api/quotes/${quoteId}/generate-pdf`, { method: "POST" });
      if (res.ok) {
        // Now download the generated file
        window.open(`/api/quotes/${quoteId}/generate-pdf`, "_blank");
      } else {
        const data = await res.json();
        setError(data.error || "PDF generation failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={handleClick}
        disabled={generating}
        className="inline-block px-8 py-3 bg-black text-white text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 disabled:cursor-wait tracking-wide"
      >
        {generating ? "Generating PDF..." : pdfPath ? "Download PDF" : "Generate & Download PDF"}
      </button>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}
