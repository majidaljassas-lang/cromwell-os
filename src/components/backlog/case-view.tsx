"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Upload, MessageSquare, Clock, Users, Paperclip, Tag, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";

type Message = {
  id: string;
  sourceId: string;
  lineNumber: number;
  rawTimestampText: string | null;
  parsedTimestamp: string;
  timestampConfidence: string;
  sender: string;
  rawText: string;
  parsedOk: boolean;
  isMultiline: boolean;
  lineCount: number;
  messageType: string;
  hasAttachment: boolean;
  relationType: string;
  relatedMessageId: string | null;
  duplicateGroupId: string | null;
  notes: string | null;
};

type Source = {
  id: string;
  label: string;
  sourceType: string;
  messageCount: number;
  participantList: string[];
  dateFrom: string | null;
  dateTo: string | null;
  status: string;
  _count: { messages: number };
};

type SourceGroup = {
  id: string;
  name: string;
  sourceType: string;
  sources: Source[];
};

type BacklogCase = {
  id: string;
  name: string;
  description: string | null;
  siteRef: string | null;
  status: string;
  sourceGroups: SourceGroup[];
};

const MSG_TYPES = ["UNCLASSIFIED", "ORDER", "FOLLOW-UP", "DUPLICATE", "CONFIRMATION", "DELIVERY", "OTHER"];
const MSG_TYPE_COLORS: Record<string, string> = {
  ORDER: "text-[#FF6600] bg-[#FF6600]/10",
  "FOLLOW-UP": "text-[#3399FF] bg-[#3399FF]/10",
  DUPLICATE: "text-[#888888] bg-[#333333]",
  CONFIRMATION: "text-[#00CC66] bg-[#00CC66]/10",
  DELIVERY: "text-[#9966FF] bg-[#9966FF]/10",
  UNCLASSIFIED: "text-[#666666] bg-[#222222]",
  OTHER: "text-[#888888] bg-[#333333]",
};

export function BacklogCaseView({
  backlogCase,
  stats,
  initialMessages,
  sourceMap,
}: {
  backlogCase: BacklogCase;
  stats: { messageCount: number; participants: string[]; attachmentCount: number };
  initialMessages: Message[];
  sourceMap: Record<string, { label: string; sourceType: string }>;
}) {
  const router = useRouter();
  const [messages] = useState(initialMessages);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importSourceId, setImportSourceId] = useState("");
  const [importText, setImportText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [classifyingId, setClassifyingId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState("ALL");
  const [filterSender, setFilterSender] = useState("");
  const [filterSource, setFilterSource] = useState("ALL");
  const [filterParsed, setFilterParsed] = useState("ALL");

  const allSources = backlogCase.sourceGroups.flatMap((g) => g.sources);

  async function handleAddSource(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    await fetch(`/api/backlog/cases/${backlogCase.id}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupName: fd.get("groupName"),
        sourceType: fd.get("sourceType"),
        label: fd.get("label"),
      }),
    });
    setAddSourceOpen(false);
    setSubmitting(false);
    router.refresh();
  }

  const [parsePreview, setParsePreview] = useState<{ totalLines: number; parsedOk: number; unparsed: number; parseStatus: string } | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{
    filename: string; bytes: number; lineCount: number; status: string;
    parseStatus: string; parseProgressPct: number; messageCount: number; unparsedLines: number;
  } | null>(null);

  async function handleFileUpload() {
    if (!importSourceId || !importFile) return;
    setSubmitting(true);
    const fd = new FormData();
    fd.append("file", importFile);

    const res = await fetch(`/api/backlog/sources/${importSourceId}/upload`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json();

    if (res.ok) {
      setUploadStatus({
        filename: data.filename, bytes: data.bytes, lineCount: data.lineCount,
        status: data.status, parseStatus: data.parseStatus, parseProgressPct: 0,
        messageCount: 0, unparsedLines: 0,
      });
      // Start polling
      pollImportStatus(importSourceId);
    }
    setSubmitting(false);
  }

  async function handlePasteUpload() {
    if (!importSourceId || !importText.trim()) return;
    setSubmitting(true);
    const fd = new FormData();
    fd.append("rawText", importText);

    const res = await fetch(`/api/backlog/sources/${importSourceId}/upload`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json();

    if (res.ok) {
      setUploadStatus({
        filename: "pasted-text.txt", bytes: data.bytes, lineCount: data.lineCount,
        status: data.status, parseStatus: data.parseStatus, parseProgressPct: 0,
        messageCount: 0, unparsedLines: 0,
      });
      pollImportStatus(importSourceId);
    }
    setSubmitting(false);
  }

  function pollImportStatus(srcId: string) {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/backlog/sources/${srcId}/upload`);
      if (!res.ok) { clearInterval(interval); return; }
      const data = await res.json();
      setUploadStatus({
        filename: data.rawImportFilename || "",
        bytes: data.importBytes || 0,
        lineCount: data.importLineCount || 0,
        status: data.status,
        parseStatus: data.parseStatus,
        parseProgressPct: data.parseProgressPct || 0,
        messageCount: data.messageCount || 0,
        unparsedLines: data.unparsedLines || 0,
      });
      if (data.status === "PARSED" || data.status === "FAILED") {
        clearInterval(interval);
      }
    }, 1500);
  }

  // Legacy paste handlers (kept as fallback internals)
  async function handleImportRaw() {
    if (!importSourceId || !importText.trim()) return;
    setSubmitting(true);

    await fetch(`/api/backlog/sources/${importSourceId}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText: importText }),
    });

    // STEP 2: Preview parse (don't confirm yet)
    const previewRes = await fetch(`/api/backlog/sources/${importSourceId}/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: false }),
    });
    const preview = await previewRes.json();
    setParsePreview(preview);
    setSubmitting(false);
  }

  // STEP 3: User confirms parse
  async function handleConfirmParse() {
    if (!importSourceId) return;
    setSubmitting(true);

    await fetch(`/api/backlog/sources/${importSourceId}/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });

    setImportOpen(false);
    setImportText("");
    setParsePreview(null);
    setSubmitting(false);
    router.refresh();
  }

  async function classifyMessage(msgId: string, field: string, value: string) {
    await fetch(`/api/backlog/messages/${msgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    setClassifyingId(null);
    router.refresh();
  }

  // Filter messages
  async function deleteMessage(msgId: string) {
    if (!confirm("Delete this message?")) return;
    await fetch(`/api/backlog/messages/${msgId}`, { method: "DELETE" });
    router.refresh();
  }

  async function deleteSource(srcId: string, label: string) {
    if (!confirm(`Delete source "${label}" and ALL its messages?`)) return;
    await fetch(`/api/backlog/sources/${srcId}`, { method: "DELETE" });
    router.refresh();
  }

  async function editSourceLabel(srcId: string, newLabel: string) {
    await fetch(`/api/backlog/sources/${srcId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel }),
    });
    router.refresh();
  }

  async function editCaseName(newName: string) {
    await fetch(`/api/backlog/cases/${backlogCase.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    router.refresh();
  }

  async function deleteCase() {
    if (!confirm(`DELETE entire case "${backlogCase.name}" and ALL sources + messages? This cannot be undone.`)) return;
    await fetch(`/api/backlog/cases/${backlogCase.id}`, { method: "DELETE" });
    router.push("/backlog");
  }

  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editingSourceLabel, setEditingSourceLabel] = useState("");
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingMsgText, setEditingMsgText] = useState("");

  async function saveMessageEdit() {
    if (!editingMsgId) return;
    await fetch(`/api/backlog/messages/${editingMsgId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: editingMsgText }),
    });
    setEditingMsgId(null);
    router.refresh();
  }

  const filtered = messages.filter((m) => {
    if (filterType !== "ALL" && m.messageType !== filterType) return false;
    if (filterSender && !m.sender.toLowerCase().includes(filterSender.toLowerCase())) return false;
    if (filterSource !== "ALL" && m.sourceId !== filterSource) return false;
    if (filterParsed === "PARSED" && !m.parsedOk) return false;
    if (filterParsed === "UNPARSED" && m.parsedOk) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link href="/backlog"><Button variant="ghost" size="sm"><ArrowLeft className="size-4 mr-1" />Back</Button></Link>
            <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">{backlogCase.name}</h1>
            <Badge className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 text-[#00CC66] bg-[#00CC66]/10">{backlogCase.status}</Badge>
          </div>
          {backlogCase.siteRef && <div className="text-xs text-[#888888] ml-[72px]">{backlogCase.siteRef}</div>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={deleteCase} className="bg-[#222222] text-[#FF3333] border-[#FF3333]/30 hover:bg-[#FF3333]/10">
            <Trash2 className="size-3.5 mr-1" />Delete Case
          </Button>
          <Sheet open={addSourceOpen} onOpenChange={setAddSourceOpen}>
            <SheetTrigger render={<Button variant="outline" size="sm" className="bg-[#222222] border-[#333333] text-[#E0E0E0]"><Plus className="size-4 mr-1" />Add Source</Button>} />
            <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
              <SheetHeader><SheetTitle className="text-[#E0E0E0]">Add Source</SheetTitle></SheetHeader>
              <form onSubmit={handleAddSource} className="flex flex-col gap-4 px-4">
                <div className="space-y-1.5"><Label>Group Name *</Label><Input name="groupName" required placeholder="e.g. WhatsApp Chats" /></div>
                <div className="space-y-1.5">
                  <Label>Source Type *</Label>
                  <select name="sourceType" required className="w-full h-9 bg-[#222222] border border-[#333333] text-[#E0E0E0] text-sm px-3">
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="EMAIL">Email</option>
                    <option value="PDF">PDF</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div className="space-y-1.5"><Label>Label *</Label><Input name="label" required placeholder="e.g. WA-01 Main Group" /></div>
                <SheetFooter><Button type="submit" disabled={submitting} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">{submitting ? "Adding..." : "Add Source"}</Button></SheetFooter>
              </form>
            </SheetContent>
          </Sheet>
          <Sheet open={importOpen} onOpenChange={setImportOpen}>
            <SheetTrigger render={<Button className="bg-[#FF6600] text-black hover:bg-[#FF9900]"><Upload className="size-4 mr-1" />Import Messages</Button>} />
            <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333] w-[500px] sm:max-w-[500px]">
              <SheetHeader><SheetTitle className="text-[#E0E0E0]">Import WhatsApp Export</SheetTitle></SheetHeader>
              <div className="flex flex-col gap-4 px-4">
                <div className="space-y-1.5">
                  <Label>Source</Label>
                  <select value={importSourceId} onChange={(e) => setImportSourceId(e.target.value)} className="w-full h-9 bg-[#222222] border border-[#333333] text-[#E0E0E0] text-sm px-3">
                    <option value="">Select source...</option>
                    {allSources.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.sourceType})</option>)}
                  </select>
                </div>

                {/* FILE UPLOAD — PRIMARY PATH */}
                <div className="space-y-1.5">
                  <Label>Upload WhatsApp .txt Export File</Label>
                  <input
                    type="file"
                    accept=".txt,.text"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-[#E0E0E0] file:bg-[#FF6600] file:text-black file:border-0 file:px-3 file:py-1.5 file:text-xs file:font-bold file:mr-3 file:cursor-pointer bg-[#222222] border border-[#333333] p-1"
                  />
                  <div className="text-[9px] text-[#666666]">
                    Upload the complete exported .txt file. No manual chunking required.<br/>
                    File is stored verbatim before parsing. Zero data loss.
                  </div>
                </div>

                {!uploadStatus && (
                  <Button onClick={handleFileUpload} disabled={submitting || !importSourceId || !importFile} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                    {submitting ? "Uploading..." : "Upload & Parse"}
                  </Button>
                )}

                {/* UPLOAD + PARSE STATUS */}
                {uploadStatus && (
                  <div className="border border-[#333333] bg-[#151515] p-3 space-y-2">
                    <div className="text-[10px] uppercase tracking-widest text-[#FF6600] font-bold">IMPORT STATUS</div>
                    <div className="grid grid-cols-2 gap-2 text-xs bb-mono">
                      <div><span className="text-[#888888]">File:</span> <span className="text-[#E0E0E0]">{uploadStatus.filename}</span></div>
                      <div><span className="text-[#888888]">Size:</span> <span className="text-[#E0E0E0]">{(uploadStatus.bytes / 1024).toFixed(1)} KB</span></div>
                      <div><span className="text-[#888888]">Raw lines:</span> <span className="text-[#E0E0E0]">{uploadStatus.lineCount}</span></div>
                      <div><span className="text-[#888888]">Status:</span> <Badge className={`text-[8px] ${uploadStatus.parseStatus === "COMPLETE" ? "text-[#00CC66] bg-[#00CC66]/10" : uploadStatus.parseStatus === "FAILED" ? "text-[#FF3333] bg-[#FF3333]/10" : "text-[#FF9900] bg-[#FF9900]/10"}`}>{uploadStatus.status}</Badge></div>
                    </div>
                    {uploadStatus.parseProgressPct !== undefined && uploadStatus.parseProgressPct < 100 && uploadStatus.status === "PROCESSING" && (
                      <div className="w-full bg-[#333333] h-1.5">
                        <div className="bg-[#FF6600] h-1.5 transition-all" style={{ width: `${uploadStatus.parseProgressPct}%` }} />
                      </div>
                    )}
                    {uploadStatus.messageCount > 0 && (
                      <div className="grid grid-cols-2 gap-2 text-xs bb-mono">
                        <div><span className="text-[#888888]">Messages:</span> <span className="text-[#00CC66]">{uploadStatus.messageCount}</span></div>
                        <div><span className="text-[#888888]">Unparsed:</span> <span className={uploadStatus.unparsedLines > 0 ? "text-[#FF9900]" : "text-[#00CC66]"}>{uploadStatus.unparsedLines}</span></div>
                      </div>
                    )}
                    {uploadStatus.status === "PARSED" && (
                      <Button onClick={() => { setImportOpen(false); setUploadStatus(null); setImportFile(null); router.refresh(); }} className="bg-[#00CC66] text-black hover:bg-[#00AA55] w-full">
                        Done — View Timeline
                      </Button>
                    )}
                  </div>
                )}

                {/* PASTE FALLBACK */}
                <details className="text-[9px] text-[#666666]">
                  <summary className="cursor-pointer hover:text-[#888888]">Or paste text manually (fallback)</summary>
                  <div className="mt-2 space-y-2">
                    <Textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={8}
                      className="bg-[#222222] border-[#333333] text-[#E0E0E0] text-[10px] bb-mono leading-tight"
                      placeholder="Paste WhatsApp export text here..." />
                    <Button onClick={handlePasteUpload} disabled={submitting || !importSourceId || !importText.trim()} size="sm" className="bg-[#222222] border border-[#333333] text-[#E0E0E0]">
                      {submitting ? "Uploading..." : "Upload Pasted Text"}
                    </Button>
                  </div>
                </details>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="flex items-center gap-2"><MessageSquare className="size-4 text-[#FF6600]" /><span className="text-[9px] uppercase tracking-widest text-[#888888]">MESSAGES</span></div>
          <div className="text-lg font-bold bb-mono text-[#E0E0E0] mt-1">{stats.messageCount}</div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="flex items-center gap-2"><Users className="size-4 text-[#3399FF]" /><span className="text-[9px] uppercase tracking-widest text-[#888888]">PARTICIPANTS</span></div>
          <div className="text-lg font-bold bb-mono text-[#E0E0E0] mt-1">{stats.participants.length}</div>
          <div className="text-[9px] text-[#666666] mt-0.5 truncate">{stats.participants.slice(0, 5).join(", ")}</div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="flex items-center gap-2"><Paperclip className="size-4 text-[#FF9900]" /><span className="text-[9px] uppercase tracking-widest text-[#888888]">ATTACHMENTS</span></div>
          <div className="text-lg font-bold bb-mono text-[#E0E0E0] mt-1">{stats.attachmentCount}</div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="flex items-center gap-2"><Clock className="size-4 text-[#00CC66]" /><span className="text-[9px] uppercase tracking-widest text-[#888888]">SOURCES</span></div>
          <div className="text-lg font-bold bb-mono text-[#E0E0E0] mt-1">{allSources.length}</div>
        </div>
      </div>

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline ({filtered.length})</TabsTrigger>
          <TabsTrigger value="sources">Sources ({allSources.length})</TabsTrigger>
        </TabsList>

        {/* TIMELINE TAB */}
        <TabsContent value="timeline" className="mt-4 space-y-3">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] text-[#888888] uppercase tracking-widest">FILTER:</span>
            {["ALL", ...MSG_TYPES].map((t) => (
              <button key={t} onClick={() => setFilterType(t)}
                className={`text-[9px] px-2 py-0.5 uppercase tracking-wider ${filterType === t ? "bg-[#FF6600] text-black" : "text-[#888888] hover:text-[#E0E0E0]"}`}>
                {t}
              </button>
            ))}
            <span className="text-[#555555]">|</span>
            <span className="text-[9px] text-[#888888]">SRC:</span>
            <button onClick={() => setFilterSource("ALL")} className={`text-[9px] px-2 py-0.5 ${filterSource === "ALL" ? "bg-[#FF6600] text-black" : "text-[#888888]"}`}>All</button>
            {allSources.map((s) => (
              <button key={s.id} onClick={() => setFilterSource(s.id)} className={`text-[9px] px-2 py-0.5 ${filterSource === s.id ? "bg-[#3399FF] text-black" : "text-[#888888]"}`}>{s.label.split(" ")[0]}</button>
            ))}
            <span className="text-[#555555]">|</span>
            <button onClick={() => setFilterParsed("ALL")} className={`text-[9px] px-2 py-0.5 ${filterParsed === "ALL" ? "bg-[#FF6600] text-black" : "text-[#888888]"}`}>All</button>
            <button onClick={() => setFilterParsed("PARSED")} className={`text-[9px] px-2 py-0.5 ${filterParsed === "PARSED" ? "bg-[#00CC66] text-black" : "text-[#888888]"}`}>Parsed</button>
            <button onClick={() => setFilterParsed("UNPARSED")} className={`text-[9px] px-2 py-0.5 ${filterParsed === "UNPARSED" ? "bg-[#FF9900] text-black" : "text-[#888888]"}`}>Unparsed</button>
            <span className="text-[#555555]">|</span>
            <Input value={filterSender} onChange={(e) => setFilterSender(e.target.value)}
              placeholder="Filter by sender..." className="h-6 w-40 text-[10px] bg-[#222222] border-[#333333]" />
          </div>

          {/* Messages */}
          {filtered.length === 0 ? (
            <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center text-[#888888]">
              No messages yet. Import messages from a source.
            </div>
          ) : (
            <div className="border border-[#333333] bg-[#1A1A1A]">
              {filtered.map((msg) => (
                <div key={msg.id} className={`border-b border-[#2A2A2A] px-3 py-2 hover:bg-[#1E1E1E] ${msg.relationType === "DUPLICATE_OF" ? "opacity-50" : ""} ${!msg.parsedOk ? "border-l-2 border-l-[#FF9900]" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[9px] bb-mono ${msg.timestampConfidence === "LOW" ? "text-[#FF3333]" : msg.timestampConfidence === "MEDIUM" ? "text-[#FF9900]" : "text-[#666666]"}`} title={msg.rawTimestampText || "no raw timestamp"}>
                          {new Date(msg.parsedTimestamp).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          {msg.timestampConfidence !== "HIGH" && <span className="ml-1 text-[7px]">({msg.timestampConfidence})</span>}
                        </span>
                        <span className="text-[10px] font-bold text-[#3399FF]">{msg.sender}</span>
                        <span className="text-[8px] text-[#555555]">{sourceMap[msg.sourceId]?.label || ""}</span>
                        {msg.hasAttachment && <Paperclip className="size-2.5 text-[#FF9900]" />}
                        {!msg.parsedOk && <Badge className="text-[7px] px-1 py-0 text-[#FF9900] bg-[#FF9900]/10">UNPARSED</Badge>}
                        {msg.isMultiline && <Badge className="text-[7px] px-1 py-0 text-[#00CCCC] bg-[#00CCCC]/10">{msg.lineCount}L</Badge>}
                        {msg.relationType !== "NONE" && <Badge className="text-[7px] px-1 py-0 text-[#3399FF] bg-[#3399FF]/10">{msg.relationType.replace(/_/g, " ")}</Badge>}
                      </div>
                      <div className="text-xs text-[#E0E0E0] whitespace-pre-wrap">{msg.rawText}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {classifyingId === msg.id ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex gap-0.5 flex-wrap">
                            <span className="text-[6px] text-[#555555] w-8">TYPE:</span>
                            {MSG_TYPES.filter((t) => t !== "UNCLASSIFIED").map((t) => (
                              <button key={t} onClick={() => classifyMessage(msg.id, "messageType", t)}
                                className={`text-[7px] px-1.5 py-0.5 uppercase tracking-wider ${MSG_TYPE_COLORS[t] || "text-[#888888] bg-[#333333]"}`}>
                                {t}
                              </button>
                            ))}
                          </div>
                          <div className="flex gap-0.5 flex-wrap">
                            <span className="text-[6px] text-[#555555] w-8">REL:</span>
                            {["NONE", "DUPLICATE_OF", "FOLLOW_UP_TO", "CONFIRMATION_OF"].map((r) => (
                              <button key={r} onClick={() => classifyMessage(msg.id, "relationType", r)}
                                className="text-[7px] px-1.5 py-0.5 uppercase tracking-wider text-[#3399FF] bg-[#3399FF]/10">
                                {r.replace(/_/g, " ")}
                              </button>
                            ))}
                          </div>
                          <button onClick={() => setClassifyingId(null)} className="text-[7px] px-1 text-[#666666] self-end">✕ close</button>
                        </div>
                      ) : (
                        <button onClick={() => setClassifyingId(msg.id)}
                          className={`text-[8px] px-1.5 py-0.5 uppercase tracking-wider cursor-pointer ${MSG_TYPE_COLORS[msg.messageType] || "text-[#666666] bg-[#222222]"}`}>
                          {msg.messageType}
                        </button>
                      )}
                      <button onClick={() => deleteMessage(msg.id)} className="p-0.5 hover:bg-[#FF3333]/10 ml-1" title="Delete message"><Trash2 className="size-2.5 text-[#FF3333]/50 hover:text-[#FF3333]" /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* SOURCES TAB */}
        <TabsContent value="sources" className="mt-4 space-y-3">
          {backlogCase.sourceGroups.map((g) => (
            <div key={g.id} className="space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">{g.sourceType}: {g.name}</div>
              {g.sources.map((s) => (
                <div key={s.id} className="border border-[#333333] bg-[#1A1A1A] p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm text-[#E0E0E0]">{s.label}</div>
                    <div className="text-[9px] text-[#666666] bb-mono mt-0.5">
                      {s._count.messages} messages
                      {s.dateFrom && <> · {new Date(s.dateFrom).toLocaleDateString("en-GB")} – {s.dateTo ? new Date(s.dateTo).toLocaleDateString("en-GB") : "now"}</>}
                    </div>
                    {s.participantList.length > 0 && (
                      <div className="text-[8px] text-[#555555] mt-0.5">{s.participantList.join(", ")}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[9px] ${s.status === "IMPORTED" || s.status === "PARSED" ? "text-[#00CC66] bg-[#00CC66]/10" : "text-[#FF9900] bg-[#FF9900]/10"}`}>{s.status}</Badge>
                    {editingSourceId === s.id ? (
                      <div className="flex items-center gap-1">
                        <input value={editingSourceLabel} onChange={(e) => setEditingSourceLabel(e.target.value)} className="h-6 w-32 text-xs bg-[#222222] border border-[#FF6600] text-[#E0E0E0] px-1" onKeyDown={(e) => { if (e.key === "Enter") { editSourceLabel(s.id, editingSourceLabel); setEditingSourceId(null); } }} autoFocus />
                        <button onClick={() => { editSourceLabel(s.id, editingSourceLabel); setEditingSourceId(null); }} className="p-0.5 hover:bg-[#FF6600]/10"><Pencil className="size-3 text-[#FF6600]" /></button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingSourceId(s.id); setEditingSourceLabel(s.label); }} className="p-0.5 hover:bg-[#FF6600]/10" title="Edit label"><Pencil className="size-3 text-[#888888]" /></button>
                    )}
                    <button onClick={() => deleteSource(s.id, s.label)} className="p-0.5 hover:bg-[#FF3333]/10" title="Delete source"><Trash2 className="size-3 text-[#FF3333]" /></button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
