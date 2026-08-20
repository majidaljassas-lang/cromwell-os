"use client";

import { useEffect, useState } from "react";
import { CustomerDetail } from "./customer-detail";

type EmbedPayload = Parameters<typeof CustomerDetail>[0];

export function CustomerEmbedded({ customerId }: { customerId: string }) {
  const [data, setData] = useState<EmbedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/customers/${customerId}/embed`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!alive) return;
        if (!ok) {
          setError(j.error || "Failed to load");
          return;
        }
        setData({ ...j, embedded: true });
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Network error");
      });
    return () => {
      alive = false;
    };
  }, [customerId]);

  if (error) {
    return <div className="p-4 text-xs text-[#FF3333]">{error}</div>;
  }
  if (!data) {
    return <div className="p-4 text-xs text-[#888888]">Loading customer...</div>;
  }
  return <CustomerDetail {...data} />;
}
