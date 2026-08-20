"use client";

import { useEffect, useState } from "react";
import { CustomerSitePicker } from "@/components/shared/customer-site-picker";

export type Tag = {
  id: string;
  name: string;
  label: string;
  routingHandler: string | null;
  category: "FINANCIAL" | "OPERATIONAL" | "BOTH";
  active: boolean;
  sortOrder: number;
};

const AUTONOMOUS_HANDLERS = new Set([
  "bill_parser",
  "statement",
  "order",
  "quote_request",
  "competitive_bid",
  "spec",
  "approval",
  "po_received",
  "order_ack",
]);
const NOISE_HANDLERS = new Set(["noise"]);

// Handlers that create a commercial Ticket (need customer + site allocation).
// Bill/statement parsers don't — they post to AP and don't need a site.
const TICKET_CREATING_HANDLERS = new Set([
  "order",
  "quote_request",
  "competitive_bid",
  "spec",
  "approval",
  "po_received",
  "order_ack",
]);

export function groupTag(tag: Tag): "AUTONOMOUS" | "LOG" | "NOISE" {
  const h = tag.routingHandler ?? "";
  if (NOISE_HANDLERS.has(h)) return "NOISE";
  if (AUTONOMOUS_HANDLERS.has(h)) return "AUTONOMOUS";
  return "LOG";
}

export function GROUP_COLOUR(group: "AUTONOMOUS" | "LOG" | "NOISE"): string {
  switch (group) {
    case "AUTONOMOUS":
      return "#00CC66";
    case "LOG":
      return "#FFCC00";
    case "NOISE":
      return "#888";
  }
}

// Module-level cache so we only fetch /api/classification-tags once per session.
let _tagsCache: Tag[] | null = null;
let _tagsPromise: Promise<Tag[]> | null = null;

export function useClassificationTags(): Tag[] {
  const [tags, setTags] = useState<Tag[]>(_tagsCache ?? []);
  useEffect(() => {
    if (_tagsCache) return;
    if (!_tagsPromise) {
      _tagsPromise = fetch("/api/classification-tags")
        .then((r) => r.json())
        .then((d) => {
          const raw: Tag[] = Array.isArray(d) ? d : d.tags ?? [];
          const filtered = raw.filter((t) => t.active).sort((a, b) => a.sortOrder - b.sortOrder);
          _tagsCache = filtered;
          return filtered;
        })
        .catch(() => [] as Tag[]);
    }
    _tagsPromise.then(setTags);
  }, []);
  return tags;
}

interface TriageTilesProps {
  threadId: string;
  /** Called after a successful classify so the parent can refresh / advance. */
  onClassified?: (result: { ok: boolean; handler: string | null; message: string; tagName: string; nextThreadId: string | null }) => void;
  /** Optional: hide the group titles for compact embed (e.g. inside a drawer). */
  compact?: boolean;
}

export function TriageTiles({ threadId, onClassified, compact = false }: TriageTilesProps) {
  const tags = useClassificationTags();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerTag, setPickerTag] = useState<Tag | null>(null);

  async function submitClassify(tag: Tag, customerId: string | null, siteId: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/inbox/threads/${threadId}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagName: tag.name, customerId, siteId }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.message ?? j.error ?? "Classification failed");
        onClassified?.({ ok: false, handler: j.handler ?? null, message: j.message ?? j.error ?? "failed", tagName: tag.name, nextThreadId: null });
        return;
      }
      onClassified?.({
        ok: true,
        handler: j.handler ?? null,
        message: j.message ?? "",
        tagName: tag.name,
        nextThreadId: j.nextThreadId ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Classification failed");
    } finally {
      setBusy(false);
    }
  }

  function classify(tag: Tag) {
    if (busy) return;
    const handler = tag.routingHandler ?? "";
    if (TICKET_CREATING_HANDLERS.has(handler)) {
      // Commercial tag — let the user allocate customer + site before creating the ticket.
      setPickerTag(tag);
      return;
    }
    void submitClassify(tag, null, null);
  }

  const grouped: Record<"AUTONOMOUS" | "LOG" | "NOISE", Tag[]> = {
    AUTONOMOUS: [],
    LOG: [],
    NOISE: [],
  };
  for (const t of tags) grouped[groupTag(t)].push(t);

  return (
    <div className="space-y-2">
      <Group title="🟢 Autonomous — runs the engine end-to-end" colour={GROUP_COLOUR("AUTONOMOUS")} tags={grouped.AUTONOMOUS} busy={busy} onPick={classify} compact={compact} />
      <Group title="🟡 Log — raises a task, manual follow-up" colour={GROUP_COLOUR("LOG")} tags={grouped.LOG} busy={busy} onPick={classify} compact={compact} />
      <Group title="⚪ Noise" colour={GROUP_COLOUR("NOISE")} tags={grouped.NOISE} busy={busy} onPick={classify} compact={compact} />
      {error && <div className="text-[11px] text-[#FF6666] bb-mono">{error}</div>}
      {pickerTag && (
        <CustomerSitePicker
          headline={pickerTag.label}
          subheadline="Allocate before creating"
          confirmLabel="Create Ticket"
          busy={busy}
          onCancel={() => setPickerTag(null)}
          onConfirm={async (customerId, siteId) => {
            const tag = pickerTag;
            setPickerTag(null);
            await submitClassify(tag, customerId, siteId);
          }}
        />
      )}
    </div>
  );
}

function Group({
  title,
  colour,
  tags,
  busy,
  onPick,
  compact,
}: {
  title: string;
  colour: string;
  tags: Tag[];
  busy: boolean;
  onPick: (tag: Tag) => void;
  compact: boolean;
}) {
  if (tags.length === 0) return null;
  return (
    <div>
      {!compact && (
        <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: colour }}>
          {title}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() => onPick(tag)}
            disabled={busy || !tag.routingHandler}
            className="text-[11px] px-3 py-1.5 border bg-[#0A0A0A] hover:bg-[#1A1A1A] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              borderColor: colour,
              color: tag.routingHandler ? colour : "#555",
            }}
            title={tag.routingHandler ? `Run ${tag.routingHandler}` : "No handler"}
          >
            {tag.label}
          </button>
        ))}
      </div>
    </div>
  );
}
