"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  REACTIONS,
  alternativesTo,
  type ReactionId,
  type ReactionSpec,
} from "@/lib/inbox/reactions";

type Customer = { id: string; name: string };
type Site = { id: string; siteName: string };
type CommercialLink = { customerId: string; siteId: string };

type AliasPromptData = {
  sender: { name: string | null; email: string | null; domain: string | null; raw: string | null };
  suggested: Array<{ id: string; name: string; score: number }>;
  all: Array<{ id: string; name: string }>;
};

type ThreadCtx = {
  id: string;
  subject: string | null;
  aiSummary?: string | null;
  aiClassification?: string | null;
  aiEntities?: {
    customerName?: string | null;
    siteName?: string | null;
  } | null;
  linkedTicket: { id: string; ticketNo: number; title: string } | null;
};

interface Props {
  thread: ThreadCtx;
  reactionId: ReactionId;
  customers: Customer[];
  sites: Site[];
  commercialLinks: CommercialLink[];
  onChangeReaction: (next: ReactionId) => void;
  onComplete: () => void;
  onCancel: () => void;
}

const TICKET_LINKER_REACTIONS = new Set<ReactionId>([
  "PROCESS_ORDER",
  "ACKNOWLEDGE_APPROVAL",
  "PROCESS_CHANGE_ORDER",
  "REVIEW_SUPPLIER_QUOTE",
  "MATCH_ORDER_ACK",
  "ATTACH_DISPATCH_NOTE",
  "FLAG_BACKORDER",
  "TRIAGE_COMPLAINT",
  "ANSWER_DELIVERY_QUERY",
  "CONVERT_TO_TICKET",
  "RESOLVE_INVOICE_QUERY",
]);

export function ReactionPanel({
  thread,
  reactionId,
  customers,
  sites,
  commercialLinks,
  onChangeReaction,
  onComplete,
  onCancel,
}: Props) {
  const router = useRouter();
  const spec: ReactionSpec = REACTIONS[reactionId];
  const alts = alternativesTo(reactionId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aliasPrompt, setAliasPrompt] = useState<AliasPromptData | null>(null);

  // Bill reactions need a supplier to resolve. Pre-flight check: if the sender
  // doesn't map to a known Supplier or alias, pop the alias-link modal first
  // so the user can map it inline (Zoho's "New vendor X found" flow). Only
  // then do we fire the reaction. Without this the bill bounces silently into
  // /parties/review and Majid has to navigate elsewhere to recover.
  async function maybePromptForAlias(): Promise<boolean> {
    if (reactionId !== "PROCESS_BILL" && reactionId !== "PROCESS_CREDIT_NOTE") return true;
    try {
      const r = await fetch(`/api/inbox/threads/${thread.id}/check-supplier`, { method: "POST" });
      const j = (await r.json()) as
        | { resolved: true; supplierName: string }
        | {
            resolved: false;
            sender: { name: string | null; email: string | null; domain: string | null; raw: string | null };
            suggestedSuppliers: Array<{ id: string; name: string; score: number }>;
            allSuppliers: Array<{ id: string; name: string }>;
          };
      if (!r.ok || !("resolved" in j)) return true;
      if (j.resolved) return true;
      setAliasPrompt({
        sender: j.sender,
        suggested: j.suggestedSuppliers,
        all: j.allSuppliers,
      });
      return false;
    } catch {
      return true; // network failure → fall through to existing reaction path
    }
  }

  async function callReact(extraOverrides?: { linkedTicketId?: string }) {
    setBusy(true);
    setError(null);
    try {
      // If the user picked a specific ticket via the linker, set that as the
      // thread's linkedTicketId BEFORE running the reaction so the runner
      // captures it.
      if (extraOverrides?.linkedTicketId) {
        await fetch(`/api/inbox/threads/${thread.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "LINK", ticketId: extraOverrides.linkedTicketId }),
        });
      }
      const r = await fetch(`/api/inbox/threads/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REACT", reactionId }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.message ?? j.error ?? "Reaction failed");
        return;
      }
      onComplete();
      // Land the user at the destination workspace so they can do the actual
      // work (bill allocation, statement reconcile, quote build, etc).
      // Skip when the destination is just /inbox or null.
      if (j.destinationRoute && j.destinationRoute !== "/inbox" && !j.destinationRoute.startsWith("/inbox/threads/")) {
        router.push(j.destinationRoute);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function handleCreateNew(customerId: string, siteId: string | null) {
    const params = new URLSearchParams({ fromThread: thread.id, customerId });
    if (siteId) params.set("siteId", siteId);
    router.push(`/tickets/new?${params.toString()}`);
  }

  const isLinker = TICKET_LINKER_REACTIONS.has(reactionId);

  return (
    <div className="border border-[#FF6600] bg-[#0F0F0F] p-3 mb-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[9px] uppercase tracking-widest text-[#888]">Reaction</div>
          <div className="text-sm font-bold text-[#FF6600]">{spec.label.replace(" →", "")}</div>
          <div className="text-[10px] text-[#888] mt-0.5">{spec.description}</div>
        </div>
        <select
          value={reactionId}
          onChange={(e) => onChangeReaction(e.target.value as ReactionId)}
          disabled={busy}
          className="bg-[#0A0A0A] border border-[#333] text-[10px] text-[#CCC] px-2 py-1"
          title="Pick a different reaction"
        >
          <option value={reactionId}>{spec.label.replace(" →", "")}</option>
          {alts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label.replace(" →", "")}
            </option>
          ))}
        </select>
      </div>

      {isLinker ? (
        <InlineTicketLinker
          customers={customers}
          aiCustomerName={thread.aiEntities?.customerName ?? null}
          aiSiteName={thread.aiEntities?.siteName ?? null}
          busy={busy}
          onLinkExisting={(ticketId) => callReact({ linkedTicketId: ticketId })}
          onCreateNew={handleCreateNew}
        />
      ) : (
        <NonTicketReactionForm
          spec={spec}
          busy={busy}
          onSubmit={async () => {
            const ok = await maybePromptForAlias();
            if (ok) callReact();
          }}
        />
      )}

      {aliasPrompt && (
        <AliasLinkModal
          data={aliasPrompt}
          busy={busy}
          onClose={() => setAliasPrompt(null)}
          onLinkAndProcess={async (supplierId, aliases) => {
            setBusy(true);
            try {
              for (const a of aliases) {
                if (!a) continue;
                await fetch(`/api/suppliers/${supplierId}/aliases`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ alias: a, source: a.includes("@") || a.includes(".") ? "EMAIL_DOMAIN" : "USER" }),
                });
              }
            } finally {
              setBusy(false);
            }
            setAliasPrompt(null);
            callReact();
          }}
          onSkipAndProcess={() => {
            setAliasPrompt(null);
            callReact();
          }}
        />
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-[#222]">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-[10px] uppercase tracking-widest text-[#888] hover:text-[#CCC] px-2 py-1 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {error && <div className="text-[11px] text-[#FF6666] bb-mono">{error}</div>}
    </div>
  );
}

function InlineTicketLinker({
  customers,
  aiCustomerName,
  aiSiteName,
  busy,
  onLinkExisting,
  onCreateNew,
}: {
  customers: Customer[];
  aiCustomerName: string | null;
  aiSiteName: string | null;
  busy: boolean;
  onLinkExisting: (ticketId: string) => void;
  onCreateNew: (customerId: string, siteId: string | null) => void;
}) {
  const [ticketId, setTicketId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [tickets, setTickets] = useState<Array<{ id: string; ticketNo: number; title: string }>>([]);

  // Lazy-load active tickets the first time this form mounts.
  if (tickets.length === 0 && !busy) {
    fetch("/api/tickets?active=1")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const list = Array.isArray(d) ? d : d.tickets ?? [];
        setTickets(list.map((t: { id: string; ticketNo: number; title: string }) => ({ id: t.id, ticketNo: t.ticketNo, title: t.title })));
      })
      .catch(() => {});
  }

  return (
    <div className="space-y-2">
      {(aiCustomerName || aiSiteName) && (
        <div className="text-[10px] text-[#888] bb-mono">
          AI hint:{aiCustomerName ? ` ${aiCustomerName}` : ""}{aiSiteName ? ` · ${aiSiteName}` : ""}
        </div>
      )}
      <div className="flex gap-1">
        <select
          value={ticketId}
          onChange={(e) => setTicketId(e.target.value)}
          disabled={busy}
          className="flex-1 h-7 text-[10px] bg-[#0A0A0A] border border-[#444] px-2"
        >
          <option value="">— select existing ticket —</option>
          {tickets.map((tk) => (
            <option key={tk.id} value={tk.id}>T-{tk.ticketNo} {tk.title?.slice(0, 40)}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => ticketId && onLinkExisting(ticketId)}
          disabled={busy || !ticketId}
          className="text-[10px] uppercase tracking-widest bg-[#FF6600] text-black px-3 font-bold hover:bg-[#FF7700] disabled:opacity-40"
        >
          Link
        </button>
      </div>
      <div className="flex gap-1">
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          disabled={busy}
          className="flex-1 h-7 text-[10px] bg-[#0A0A0A] border border-[#444] px-2"
        >
          <option value="">— customer for new ticket —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => customerId && onCreateNew(customerId, null)}
          disabled={busy || !customerId}
          className="text-[10px] uppercase tracking-widest border border-[#FF6600] text-[#FF6600] px-3 font-bold hover:bg-[#FF6600]/10 disabled:opacity-40"
        >
          New ticket
        </button>
      </div>
    </div>
  );
}

function NonTicketReactionForm({
  spec,
  busy,
  onSubmit,
}: {
  spec: ReactionSpec;
  busy: boolean;
  onSubmit: () => void;
}) {
  const explainer = (() => {
    switch (spec.id) {
      case "PROCESS_BILL":
        return "Confirms the bill, creates a BILL_NEEDS_REVIEW task, archives this thread. The bill itself lives in /bills and auto-clears the task when allocated + posted.";
      case "PROCESS_CREDIT_NOTE":
        return "Confirms the credit note, creates a CREDIT_NOTE_REVIEW task, archives this thread. The credit lives in /bills.";
      case "RECONCILE_STATEMENT":
        return "Routes the statement to /finance for reconcile against open AP bills. Clean match auto-clears; mismatches surface as STATEMENT_UNMATCHED_BILL tasks.";
      case "ALLOCATE_REMITTANCE":
        return "Routes the remittance to /banking for matching against open invoices. Clean match auto-clears.";
      case "SEND_STATEMENT":
        return "Logs a SEND_STATEMENT task on the customer; archives this thread.";
      case "ARCHIVE_NOISE":
        return "Marks as noise and removes from the inbox. No task. No follow-up.";
      case "VERIFY_BANK_DETAILS":
        return "CRITICAL — creates a BANK_DETAIL_CHANGE_ALERT task at the supplier. Confirm by phone before paying.";
      case "PREPARE_QUOTE":
      case "CONFIRM_AVAILABILITY":
      case "ANSWER_RFI":
        return "Creates a task; clicking submit takes you to the destination workspace where the actual work happens.";
      default:
        return spec.description;
    }
  })();

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-[#888] bb-mono leading-relaxed">{explainer}</div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy}
        className="w-full text-[10px] uppercase tracking-widest bg-[#FF6600] text-black py-2 px-3 font-bold hover:bg-[#FF7700] disabled:opacity-40"
      >
        {busy ? "Working…" : `Confirm · ${spec.label.replace(" →", "")}`}
      </button>
    </div>
  );
}

function AliasLinkModal({
  data,
  busy,
  onClose,
  onLinkAndProcess,
  onSkipAndProcess,
}: {
  data: AliasPromptData;
  busy: boolean;
  onClose: () => void;
  onLinkAndProcess: (supplierId: string, aliases: Array<string | null>) => void;
  onSkipAndProcess: () => void;
}) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [linkName, setLinkName] = useState(true);
  const [linkDomain, setLinkDomain] = useState(true);

  const lower = search.toLowerCase();
  const visible = lower
    ? data.all.filter((s) => s.name.toLowerCase().includes(lower)).slice(0, 30)
    : [...data.suggested.map(({ id, name }) => ({ id, name })), ...data.all.filter((s) => !data.suggested.some((x) => x.id === s.id)).slice(0, 30 - data.suggested.length)];

  const senderNameDisplay = data.sender.name ?? data.sender.email ?? data.sender.raw ?? "(unknown)";

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-[#0A0A0A] border border-[#FF6600] max-w-xl w-full p-4 space-y-3">
        <div>
          <div className="text-[9px] uppercase tracking-widest text-[#FF6600]">Unknown supplier</div>
          <div className="text-sm text-[#CCC] bb-mono mt-1">{senderNameDisplay}</div>
          {data.sender.email && (
            <div className="text-[10px] text-[#888] bb-mono">{data.sender.email}</div>
          )}
        </div>

        <div className="text-[10px] text-[#888] bb-mono leading-relaxed">
          Link this sender to an existing supplier so future bills auto-resolve.
          {data.suggested.length > 0 && " Top matches highlighted."}
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search suppliers…"
          className="w-full bg-[#1A1A1A] border border-[#2A2A2A] text-[11px] text-[#CCC] px-2 py-1.5 bb-mono"
        />

        <div className="max-h-64 overflow-auto border border-[#2A2A2A]">
          {visible.length === 0 && (
            <div className="text-[10px] text-[#666] p-3 text-center">No suppliers match.</div>
          )}
          {visible.map((s) => {
            const isSuggested = data.suggested.some((x) => x.id === s.id);
            const isPicked = picked === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setPicked(isPicked ? null : s.id)}
                className={`block w-full text-left px-3 py-2 text-[11px] bb-mono border-b border-[#1A1A1A] ${
                  isPicked
                    ? "bg-[#FF6600] text-black"
                    : isSuggested
                    ? "bg-[#1A1410] text-[#FFCC00] hover:bg-[#2A1A10]"
                    : "text-[#CCC] hover:bg-[#1A1A1A]"
                }`}
              >
                {isSuggested && !isPicked && <span className="mr-2 text-[9px]">★</span>}
                {s.name}
              </button>
            );
          })}
        </div>

        {picked && (
          <div className="border border-[#2A2A2A] p-2 space-y-1.5">
            <div className="text-[9px] uppercase tracking-widest text-[#888]">Aliases to write</div>
            {data.sender.name && (
              <label className="flex items-center gap-2 text-[10px] bb-mono text-[#CCC]">
                <input
                  type="checkbox"
                  checked={linkName}
                  onChange={(e) => setLinkName(e.target.checked)}
                />
                Sender name: <span className="text-[#FFCC00]">{data.sender.name}</span>
              </label>
            )}
            {data.sender.domain && (
              <label className="flex items-center gap-2 text-[10px] bb-mono text-[#CCC]">
                <input
                  type="checkbox"
                  checked={linkDomain}
                  onChange={(e) => setLinkDomain(e.target.checked)}
                />
                Email domain: <span className="text-[#FFCC00]">{data.sender.domain}</span>
              </label>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-[#222]">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-[10px] uppercase tracking-widest text-[#888] hover:text-[#CCC] px-2 py-1 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSkipAndProcess}
            disabled={busy}
            className="text-[10px] uppercase tracking-widest text-[#FF9900] hover:text-[#FFCC00] px-2 py-1 border border-[#553300] disabled:opacity-50"
            title="Run the reaction anyway — supplier will land in /parties/review"
          >
            Skip · Process anyway
          </button>
          <button
            type="button"
            onClick={() =>
              picked &&
              onLinkAndProcess(picked, [
                linkName ? data.sender.name : null,
                linkDomain ? data.sender.domain : null,
              ])
            }
            disabled={busy || !picked}
            className="text-[10px] uppercase tracking-widest bg-[#FF6600] text-black px-3 py-1 font-bold hover:bg-[#FF7700] disabled:opacity-30"
          >
            Link &amp; Process
          </button>
        </div>
      </div>
    </div>
  );
}
