"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Item = {
  id: string;
  queueType: "UNRESOLVED_SUPPLIER" | "UNRESOLVED_CUSTOMER";
  rawValue: string | null;
  description: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
};

type Party = { id: string; name: string };

export function ReviewQueueClient({
  items,
  suppliers,
  customers,
}: {
  items: Item[];
  suppliers: Party[];
  customers: Party[];
}) {
  const supplierItems = items.filter((i) => i.queueType === "UNRESOLVED_SUPPLIER");
  const customerItems = items.filter((i) => i.queueType === "UNRESOLVED_CUSTOMER");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-sm font-bold tracking-widest text-[#FF6600] bb-mono">
          PARTIES · REVIEW QUEUE
        </h1>
        <p className="text-[11px] text-[#888888] bb-mono mt-1">
          Unknown senders / parsed names that need to be matched to an existing party
          or created. Auto-intake is off — these queue here instead of becoming silent
          stubs.
        </p>
      </header>

      <Section
        title={`SUPPLIERS · ${supplierItems.length}`}
        items={supplierItems}
        choices={suppliers}
        emptyMsg="No unresolved suppliers."
      />

      <Section
        title={`CUSTOMERS · ${customerItems.length}`}
        items={customerItems}
        choices={customers}
        emptyMsg="No unresolved customers."
      />
    </div>
  );
}

function Section({
  title,
  items,
  choices,
  emptyMsg,
}: {
  title: string;
  items: Item[];
  choices: Party[];
  emptyMsg: string;
}) {
  return (
    <section className="border border-[#2A2A2A] rounded">
      <div className="px-3 py-2 border-b border-[#2A2A2A] text-[10px] tracking-[0.2em] text-[#FF6600] bb-mono">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="px-3 py-6 text-[11px] text-[#666666] bb-mono">{emptyMsg}</div>
      ) : (
        <ul className="divide-y divide-[#2A2A2A]">
          {items.map((item) => (
            <Row key={item.id} item={item} choices={choices} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ item, choices }: { item: Item; choices: Party[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"idle" | "match" | "create">("idle");
  const [search, setSearch] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [newName, setNewName] = useState(item.rawValue ?? "");
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return choices.slice(0, 8);
    return choices
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [choices, search]);

  const [flash, setFlash] = useState<string | null>(null);

  async function call(body: object) {
    setError(null);
    setFlash(null);
    const res = await fetch(`/api/parties/review/${item.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    const parts: string[] = [];
    if (typeof j.siblingsResolved === "number" && j.siblingsResolved > 0) {
      parts.push(`+${j.siblingsResolved} sibling${j.siblingsResolved === 1 ? "" : "s"} cleared`);
    }
    if (j.retriggered) {
      const r = j.retriggered as { intakeDocs: number; ingestionEvents: number };
      if (r.intakeDocs > 0) parts.push(`${r.intakeDocs} bill${r.intakeDocs === 1 ? "" : "s"} requeued`);
      if (r.ingestionEvents > 0) parts.push(`${r.ingestionEvents} event${r.ingestionEvents === 1 ? "" : "s"} reclassified`);
    }
    if (parts.length) setFlash(parts.join(" · "));
    startTransition(() => router.refresh());
  }

  return (
    <li className="px-3 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-[#E0E0E0] bb-mono font-medium truncate">
            {item.rawValue ?? "(no raw value)"}
          </div>
          <div className="text-[10px] text-[#888888] bb-mono mt-0.5">
            {item.description}
          </div>
          <div className="text-[10px] text-[#555555] bb-mono mt-0.5">
            {item.entityType ? `${item.entityType} · ${item.entityId?.slice(0, 8)}` : "—"} ·{" "}
            {new Date(item.createdAt).toLocaleString()}
          </div>
        </div>
        <div className="shrink-0 flex gap-1">
          <Btn onClick={() => setMode(mode === "match" ? "idle" : "match")} active={mode === "match"}>
            MATCH
          </Btn>
          <Btn onClick={() => setMode(mode === "create" ? "idle" : "create")} active={mode === "create"}>
            CREATE
          </Btn>
          <Btn onClick={() => call({ action: "dismiss" })} disabled={pending}>
            DISMISS
          </Btn>
        </div>
      </div>

      {mode === "match" && (
        <div className="mt-2 ml-0 border-t border-[#2A2A2A] pt-2 space-y-1">
          <input
            type="text"
            placeholder="search existing…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-2 py-1 text-[11px] bg-[#0A0A0A] border border-[#2A2A2A] text-[#E0E0E0] bb-mono"
          />
          <ul className="max-h-40 overflow-y-auto">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setTargetId(c.id)}
                  className={`w-full text-left px-2 py-1 text-[11px] bb-mono ${
                    targetId === c.id ? "bg-[#FF6600] text-black" : "text-[#888] hover:bg-[#1A1A1A]"
                  }`}
                >
                  {c.name}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-2 py-1 text-[10px] text-[#555555] bb-mono">no matches</li>
            )}
          </ul>
          <div className="flex justify-end">
            <Btn
              onClick={() => targetId && call({ action: "match", targetId })}
              disabled={!targetId || pending}
            >
              CONFIRM MATCH
            </Btn>
          </div>
        </div>
      )}

      {mode === "create" && (
        <div className="mt-2 border-t border-[#2A2A2A] pt-2 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 px-2 py-1 text-[11px] bg-[#0A0A0A] border border-[#2A2A2A] text-[#E0E0E0] bb-mono"
            placeholder="party name"
          />
          <Btn
            onClick={() => newName.trim() && call({ action: "create", name: newName.trim() })}
            disabled={!newName.trim() || pending}
          >
            CREATE NEW
          </Btn>
        </div>
      )}

      {error && (
        <div className="mt-2 text-[10px] text-[#FF6666] bb-mono">{error}</div>
      )}
      {flash && (
        <div className="mt-2 text-[10px] text-[#88CC88] bb-mono">{flash}</div>
      )}
    </li>
  );
}

function Btn({
  onClick,
  children,
  disabled,
  active,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-1 text-[10px] bb-mono border transition-colors ${
        active
          ? "bg-[#FF6600] text-black border-[#FF6600]"
          : "border-[#2A2A2A] text-[#888888] hover:border-[#FF6600] hover:text-[#FF6600]"
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}
