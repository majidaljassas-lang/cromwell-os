"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

type Case = {
  id: string;
  name: string;
  description: string | null;
  customerId: string | null;
  siteId: string | null;
  siteRef: string | null;
  status: string;
  dateFrom: string | null;
  dateTo: string | null;
  createdAt: string;
  customer: { id: string; name: string } | null;
  site: { id: string; siteName: string } | null;
  sourceGroups: Array<{
    id: string;
    name: string;
    sourceType: string;
    sources: Array<{ id: string; messageCount: number; label: string; sourceType: string; dateFrom: string | null; dateTo: string | null }>;
  }>;
};

type SelectOption = { id: string; name?: string; siteName?: string };

export function BacklogCaseList({ cases, customers = [], sites = [] }: { cases: Case[]; customers?: SelectOption[]; sites?: SelectOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [siteId, setSiteId] = useState("");

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/backlog/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        description: fd.get("description") || undefined,
        siteRef: fd.get("siteRef") || undefined,
        customerId: customerId || undefined,
        siteId: siteId || undefined,
        dateFrom: fd.get("dateFrom") || undefined,
        dateTo: fd.get("dateTo") || undefined,
      }),
    });
    if (res.ok) { setOpen(false); setCustomerId(""); setSiteId(""); router.refresh(); }
    setSubmitting(false);
  }

  function fmtDate(d: string | null) {
    if (!d) return null;
    return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-[#888888]">CASES ({cases.length})</div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger render={<Button className="bg-[#FF6600] text-black hover:bg-[#FF9900]"><Plus className="size-4 mr-1" />New Case</Button>} />
          <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
            <SheetHeader>
              <SheetTitle className="text-[#E0E0E0]">New Backlog Case</SheetTitle>
              <SheetDescription className="text-[#888888]">Create a case for backlog reconstruction.</SheetDescription>
            </SheetHeader>
            <form onSubmit={handleCreate} className="flex flex-col gap-4 px-4">
              <div className="space-y-1.5">
                <Label>Customer *</Label>
                <Select value={customerId} onValueChange={(v) => setCustomerId(v ?? "")}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id} label={c.name!}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Site</Label>
                <Select value={siteId} onValueChange={(v) => setSiteId(v ?? "")}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select site" /></SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id} label={s.siteName!}>{s.siteName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Case Name *</Label><Input name="name" required placeholder="e.g. Dellow Centre" /></div>
              <div className="space-y-1.5"><Label>Site Reference</Label><Input name="siteRef" placeholder="e.g. Dellow Centre, E1" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Start Date</Label>
                  <Input name="dateFrom" type="date" />
                </div>
                <div className="space-y-1.5">
                  <Label>Approx End Date</Label>
                  <Input name="dateTo" type="date" />
                </div>
              </div>
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
                        <div className="flex items-center gap-2 text-[10px] text-[#888888] mt-0.5">
                          {c.customer && <span className="text-[#3399FF]">{c.customer.name}</span>}
                          {c.customer && c.site && <span>/</span>}
                          {c.site && <span>{c.site.siteName}</span>}
                          {!c.customer && !c.site && c.siteRef && <span>{c.siteRef}</span>}
                          {(c.dateFrom || c.dateTo) && (
                            <span className="text-[#666666] ml-2">
                              {fmtDate(c.dateFrom)}{c.dateFrom && c.dateTo && " → "}{fmtDate(c.dateTo)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-[10px] text-[#888888] bb-mono">
                      <span>{totalSources} sources</span>
                      <span>{totalMessages} messages</span>
                      <Badge className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${c.status === "ACTIVE" ? "text-[#00CC66] bg-[#00CC66]/10" : c.status === "CLOSED" ? "text-[#888888] bg-[#333333]" : "text-[#FF9900] bg-[#FF9900]/10"}`}>{c.status}</Badge>
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
