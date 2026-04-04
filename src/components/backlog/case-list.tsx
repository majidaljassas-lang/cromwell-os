"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";

type Case = {
  id: string;
  name: string;
  description: string | null;
  siteRef: string | null;
  status: string;
  createdAt: string;
  sourceGroups: Array<{
    id: string;
    name: string;
    sourceType: string;
    sources: Array<{ id: string; messageCount: number; label: string; sourceType: string; dateFrom: string | null; dateTo: string | null }>;
  }>;
};

export function BacklogCaseList({ cases }: { cases: Case[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/backlog/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: fd.get("name"), description: fd.get("description"), siteRef: fd.get("siteRef") }),
    });
    if (res.ok) { setOpen(false); router.refresh(); }
    setSubmitting(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-[#888888]">CASES ({cases.length})</div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger render={<Button className="bg-[#FF6600] text-black hover:bg-[#FF9900]"><Plus className="size-4 mr-1" />New Case</Button>} />
          <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
            <SheetHeader><SheetTitle className="text-[#E0E0E0]">New Backlog Case</SheetTitle></SheetHeader>
            <form onSubmit={handleCreate} className="flex flex-col gap-4 px-4">
              <div className="space-y-1.5"><Label>Case Name *</Label><Input name="name" required placeholder="e.g. Dellow Centre" /></div>
              <div className="space-y-1.5"><Label>Site Reference</Label><Input name="siteRef" placeholder="e.g. Dellow Centre, E1" /></div>
              <div className="space-y-1.5"><Label>Description</Label><Input name="description" placeholder="Notes about this case" /></div>
              <SheetFooter><Button type="submit" disabled={submitting} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">{submitting ? "Creating..." : "Create Case"}</Button></SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      {cases.length === 0 ? (
        <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center text-[#888888]">No backlog cases yet. Create one to begin reconstruction.</div>
      ) : (
        <div className="space-y-3">
          {cases.map((c) => {
            const totalMessages = c.sourceGroups.reduce((s, g) => s + g.sources.reduce((s2, src) => s2 + src.messageCount, 0), 0);
            const totalSources = c.sourceGroups.reduce((s, g) => s + g.sources.length, 0);
            return (
              <Link key={c.id} href={`/backlog/${c.id}`}>
                <div className="border border-[#333333] bg-[#1A1A1A] p-4 hover:bg-[#222222] cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FolderOpen className="size-5 text-[#FF6600]" />
                      <div>
                        <div className="font-bold text-[#E0E0E0]">{c.name}</div>
                        {c.siteRef && <div className="text-[10px] text-[#888888]">{c.siteRef}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-[10px] text-[#888888] bb-mono">
                      <span>{totalSources} sources</span>
                      <span>{totalMessages} messages</span>
                      <Badge className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 text-[#00CC66] bg-[#00CC66]/10">{c.status}</Badge>
                    </div>
                  </div>
                  {c.sourceGroups.length > 0 && (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      {c.sourceGroups.map((g) => (
                        <div key={g.id} className="text-[9px] text-[#666666] border border-[#333333] px-2 py-0.5">
                          {g.sourceType}: {g.sources.map((s) => s.label).join(", ")} ({g.sources.reduce((s, src) => s + src.messageCount, 0)})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
