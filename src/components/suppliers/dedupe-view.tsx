"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Merge,
  AlertCircle,
  CheckCircle2,
  Crown,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type Member = {
  id: string;
  name: string;
  legalName: string | null;
  email: string | null;
  ticketLines: number;
  bills: number;
  procurementOrders: number;
  aliases: number;
  totalLinks: number;
};

type Cluster = {
  key: string;
  members: Member[];
  bestPairScore: number;
  suggestedKeeperId: string;
};

export function DedupeView({
  clusters,
  threshold,
}: {
  clusters: Cluster[];
  threshold: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tInput, setTInput] = useState(String(threshold));
  const [busyCluster, setBusyCluster] = useState<string | null>(null);
  const [keeperOverrides, setKeeperOverrides] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  function applyThreshold() {
    const t = Number(tInput);
    if (!Number.isFinite(t) || t < 0.3 || t > 0.95) {
      setError("Threshold must be between 0.30 and 0.95");
      return;
    }
    setError(null);
    startTransition(() => {
      router.replace(`/suppliers/dedupe?threshold=${t}`);
    });
  }

  async function merge(cluster: Cluster, keeperId: string, loser: Member) {
    if (
      !confirm(
        `Merge "${loser.name}" → "${cluster.members.find((m) => m.id === keeperId)?.name}"?\n` +
          `${loser.totalLinks} link${loser.totalLinks === 1 ? "" : "s"} will be re-pointed and "${loser.name}" will be kept as an alias.`,
      )
    ) {
      return;
    }
    setError(null);
    setBusyCluster(cluster.key);
    try {
      const res = await fetch("/api/suppliers/dedupe/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keeperId, loserId: loser.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "merge failed");
      const repointedRows = (data.rowsRepointed as { rows: number }[]).reduce(
        (acc, r) => acc + r.rows,
        0,
      );
      setLastResult(
        `Merged "${loser.name}" → "${cluster.members.find((m) => m.id === keeperId)?.name}". ` +
          `${repointedRows} row${repointedRows === 1 ? "" : "s"} repointed across ${data.rowsRepointed.length} table${data.rowsRepointed.length === 1 ? "" : "s"}, ` +
          `${data.aliasesMoved} alias${data.aliasesMoved === 1 ? "" : "es"} moved.`,
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "merge failed");
    } finally {
      setBusyCluster(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-wide bb-mono text-[#FF6600]">
            SUPPLIER DEDUPE
          </h1>
          <p className="text-xs text-[#777777] bb-mono mt-1">
            Trigram-similar supplier clusters · pick a keeper, merge the rest
          </p>
        </div>
        <Link href="/suppliers" className="text-xs bb-mono text-[#888888] hover:text-[#FF6600]">
          ← Back to suppliers
        </Link>
      </div>

      <Card className="bg-[#111111] border-[#2A2A2A]">
        <CardContent className="p-3 flex items-end gap-3">
          <div>
            <div className="text-[10px] bb-mono text-[#666666] mb-1">SIMILARITY THRESHOLD</div>
            <div className="flex items-center gap-2">
              <Input
                value={tInput}
                onChange={(e) => setTInput(e.target.value)}
                className="w-24"
                type="number"
                step="0.05"
                min="0.3"
                max="0.95"
              />
              <Button
                size="sm"
                onClick={applyThreshold}
                disabled={isPending}
                className="bg-[#FF6600] text-black hover:bg-[#FF8533]"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${isPending ? "animate-spin" : ""}`} />
                Apply
              </Button>
            </div>
          </div>
          <div className="text-[10px] bb-mono text-[#666666] flex-1">
            Lower = more clusters (looser match) · higher = fewer (tighter).
            <br />
            0.55 = grey-zone floor used by the smart-match resolver.
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="bg-[#1A0A0A] border-[#4A1A1A]">
          <CardContent className="p-3 text-xs bb-mono text-[#FF7F7F] flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> {error}
          </CardContent>
        </Card>
      )}

      {lastResult && (
        <Card className="bg-[#0A1A0A] border-[#1F4F2A]">
          <CardContent className="p-3 text-xs bb-mono text-[#7FFFA1] flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> {lastResult}
          </CardContent>
        </Card>
      )}

      {clusters.length === 0 && (
        <Card className="bg-[#111111] border-[#2A2A2A]">
          <CardContent className="p-8 text-center text-[#666666] bb-mono text-xs">
            No clusters above {threshold.toFixed(2)} similarity. Lower the threshold to find looser matches.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {clusters.map((cluster) => {
          const keeperId = keeperOverrides[cluster.key] ?? cluster.suggestedKeeperId;
          const keeper = cluster.members.find((m) => m.id === keeperId)!;
          return (
            <Card key={cluster.key} className="bg-[#111111] border-[#2A2A2A]">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-[#FF6600] text-black bb-mono">
                      {(cluster.bestPairScore * 100).toFixed(0)}%
                    </Badge>
                    <span className="text-xs bb-mono text-[#888888]">
                      {cluster.members.length} similar suppliers
                    </span>
                  </div>
                </div>

                <table className="w-full text-xs bb-mono">
                  <thead>
                    <tr className="text-[10px] text-[#666666] border-b border-[#2A2A2A]">
                      <th className="text-left p-1 w-8"></th>
                      <th className="text-left p-1">NAME</th>
                      <th className="text-left p-1">LEGAL NAME</th>
                      <th className="text-left p-1">EMAIL</th>
                      <th className="text-right p-1">LINES</th>
                      <th className="text-right p-1">BILLS</th>
                      <th className="text-right p-1">POs</th>
                      <th className="text-right p-1">ALIASES</th>
                      <th className="text-right p-1 w-32">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cluster.members.map((m) => {
                      const isKeeper = m.id === keeperId;
                      return (
                        <tr key={m.id} className={`border-b border-[#1A1A1A] ${isKeeper ? "bg-[#1A2A14]" : ""}`}>
                          <td className="p-1">
                            <input
                              type="radio"
                              name={`keeper-${cluster.key}`}
                              checked={isKeeper}
                              onChange={() =>
                                setKeeperOverrides((prev) => ({ ...prev, [cluster.key]: m.id }))
                              }
                              className="accent-[#FF6600]"
                              title="Pick as keeper"
                            />
                          </td>
                          <td className="p-1">
                            <div className="flex items-center gap-1">
                              {isKeeper && <Crown className="h-3 w-3 text-[#FFE57F]" />}
                              <Link
                                href={`/suppliers/${m.id}`}
                                className="text-[#7FBFFF] hover:underline"
                              >
                                {m.name}
                              </Link>
                            </div>
                          </td>
                          <td className="p-1 text-[#AAAAAA]">{m.legalName || "—"}</td>
                          <td className="p-1 text-[#AAAAAA]">{m.email || "—"}</td>
                          <td className="p-1 text-right">{m.ticketLines}</td>
                          <td className="p-1 text-right">{m.bills}</td>
                          <td className="p-1 text-right">{m.procurementOrders}</td>
                          <td className="p-1 text-right">{m.aliases}</td>
                          <td className="p-1 text-right">
                            {isKeeper ? (
                              <Badge className="bg-[#1F4F2A] text-[#7FFFA1]">KEEPER</Badge>
                            ) : (
                              <Button
                                size="sm"
                                disabled={busyCluster === cluster.key}
                                onClick={() => merge(cluster, keeperId, m)}
                                className="bg-[#FF6600] text-black hover:bg-[#FF8533] h-6 text-[10px] px-2"
                              >
                                <Merge className="h-3 w-3 mr-1" />
                                Merge → {keeper.name.length > 18 ? `${keeper.name.slice(0, 18)}…` : keeper.name}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
