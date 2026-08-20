"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReplyComposer({
  threadId,
  channel,
  replyTo,
  subject,
  initialBody,
  reactionTaskId,
}: {
  threadId: string;
  channel: "EMAIL" | "WHATSAPP" | "WHATSAPP_GROUP" | "SMS" | "OTHER";
  replyTo: string;
  subject: string;
  initialBody: string;
  reactionTaskId: string | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launchHref = (() => {
    if (channel === "EMAIL" && replyTo) {
      const params = new URLSearchParams({ subject, body });
      return `mailto:${encodeURIComponent(replyTo)}?${params.toString()}`;
    }
    if (channel === "WHATSAPP" && replyTo) {
      const phone = replyTo.replace(/\D/g, "");
      return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
    }
    return null;
  })();

  async function markSent() {
    if (!reactionTaskId) {
      // No reaction task yet — just mark thread done.
      setBusy(true);
      try {
        const r = await fetch(`/api/inbox/threads/${threadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "DONE" }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setError(j.error ?? "Failed to mark done");
          return;
        }
        router.push("/inbox");
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/tasks/${reactionTaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE", closedBySignal: "USER_REPLY" }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.error ?? `HTTP ${r.status}`);
        return;
      }
      // Then advance the thread.
      await fetch(`/api/inbox/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DONE" }),
      });
      router.push("/inbox");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={12}
        className="w-full bg-[#0A0A0A] border border-[#333] text-[12px] text-[#E0E0E0] px-3 py-2 bb-mono"
        placeholder="Write your reply…"
      />

      <div className="flex items-center gap-2">
        {launchHref ? (
          <a
            href={launchHref}
            target="_blank"
            rel="noreferrer"
            className="bg-[#FF6600] text-black text-[10px] uppercase tracking-widest px-3 py-1.5 font-bold hover:bg-[#FF7700]"
          >
            Open in {channel === "WHATSAPP" ? "WhatsApp" : "mail client"} →
          </a>
        ) : (
          <span className="text-[10px] text-[#888]">No launch target for {channel}</span>
        )}
        <button
          onClick={markSent}
          disabled={busy}
          className="bg-[#00CC66] text-black text-[10px] uppercase tracking-widest px-3 py-1.5 font-bold hover:bg-[#00DD77] disabled:opacity-50"
          title="Close the reaction task and archive the thread"
        >
          Mark sent · close task
        </button>
        <button
          onClick={() => router.push("/inbox")}
          className="text-[10px] uppercase tracking-widest text-[#888] hover:text-[#FF6600] px-3 py-1.5"
        >
          Cancel
        </button>
      </div>

      {error && <div className="text-[11px] text-[#FF6666] bb-mono">{error}</div>}

      <div className="text-[10px] text-[#666] bb-mono pt-2 border-t border-[#222]">
        Stop-gap composer: the reply launches in your mail / WhatsApp client; once you've actually
        sent it, hit <span className="text-[#00CC66]">Mark sent</span> to close the reaction task
        and remove this thread from the inbox.
      </div>
    </div>
  );
}
