"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Row = {
  id: string;
  name: string;
  createdAt: string;
  counts: {
    tickets: number;
    ticketLines: number;
    invoices: number;
    contactLinks: number;
    commercialLinks: number;
  };
  recentTickets: { id: string; ticketNo: number; title: string; createdAt: string }[];
  contacts: {
    contactId: string;
    contactName: string;
    email: string | null;
    phone: string | null;
    siteId: string;
    siteName: string;
  }[];
};

type Suggestion = { id: string; name: string };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function CustomerPicker({
  excludeId,
  onPick,
}: {
  excludeId: string;
  onPick: (s: Suggestion | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Suggestion | null>(null);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (selected) return;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/customers?search=${encodeURIComponent(query.trim())}`);
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = (await res.json()) as Suggestion[];
        setResults(
          data
            .filter((c) => c.id !== excludeId && !c.name.includes("(auto-intake)"))
            .slice(0, 8)
        );
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, excludeId, selected]);

  if (selected) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-[11px]">{selected.name}</Badge>
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline"
          onClick={() => {
            setSelected(null);
            setQuery("");
            onPick(null);
          }}
        >
          change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={query}
        placeholder="Search real customer…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        className="h-8 text-xs"
      />
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-10 mt-1 w-64 rounded border bg-popover shadow-md text-xs max-h-56 overflow-auto">
          {loading && <div className="px-2 py-1 text-muted-foreground">Searching…</div>}
          {results.map((r) => (
            <button
              type="button"
              key={r.id}
              className="block w-full text-left px-2 py-1 hover:bg-accent"
              onMouseDown={(e) => {
                e.preventDefault();
                setSelected(r);
                setOpen(false);
                onPick(r);
              }}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AutoIntakeCleanupTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [picks, setPicks] = useState<Record<string, Suggestion | null>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const empty = rows.length === 0;

  async function reassign(sourceId: string) {
    const target = picks[sourceId];
    if (!target) return;
    setBusyId(sourceId);
    setErrors((e) => ({ ...e, [sourceId]: "" }));
    try {
      const res = await fetch("/api/customers/cleanup/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, targetId: target.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors((e) => ({ ...e, [sourceId]: data.error || "Reassign failed" }));
        return;
      }
      router.refresh();
    } catch (err) {
      setErrors((e) => ({
        ...e,
        [sourceId]: err instanceof Error ? err.message : "Network error",
      }));
    } finally {
      setBusyId(null);
    }
  }

  if (empty) {
    return (
      <div className="rounded border p-6 text-sm text-muted-foreground">
        No auto-intake customers — nothing to clean up.
      </div>
    );
  }

  return (
    <div className="rounded border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Auto-intake customer</TableHead>
            <TableHead>Sender / contact</TableHead>
            <TableHead className="w-32">Tickets</TableHead>
            <TableHead className="w-40">Last activity</TableHead>
            <TableHead className="w-80">Reassign to</TableHead>
            <TableHead className="w-24"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const pick = picks[row.id] ?? null;
            const lastTicket = row.recentTickets[0];
            const sender = row.contacts[0];
            const err = errors[row.id];
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <Link
                    href={`/customers/${row.id}`}
                    className="text-xs underline-offset-2 hover:underline"
                  >
                    {row.name}
                  </Link>
                  <div className="text-[10px] text-muted-foreground">
                    Created {formatDate(row.createdAt)}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {sender ? (
                    <>
                      <div>{sender.contactName}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {sender.email ?? sender.phone ?? "—"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        @ {sender.siteName}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  <div>{row.counts.tickets}</div>
                  {lastTicket && (
                    <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                      #{lastTicket.ticketNo} {lastTicket.title}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {lastTicket ? formatDate(lastTicket.createdAt) : "—"}
                </TableCell>
                <TableCell>
                  <CustomerPicker
                    excludeId={row.id}
                    onPick={(s) => setPicks((p) => ({ ...p, [row.id]: s }))}
                  />
                  {err && <p className="text-[10px] text-[#FF3333] mt-1">{err}</p>}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    disabled={!pick || busyId === row.id}
                    onClick={() => reassign(row.id)}
                  >
                    {busyId === row.id ? "Moving…" : "Reassign"}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
