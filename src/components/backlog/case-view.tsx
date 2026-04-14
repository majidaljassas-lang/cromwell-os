"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Upload, MessageSquare, Clock, Users, Paperclip, Tag, Trash2, Pencil, FileText, ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Loader2, Image, ShoppingCart, Package, Hash } from "lucide-react";
import { ReconciliationPanel } from "./reconciliation-panel";
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
  siteId: string | null;
  siteRef: string | null;
  status: string;
  dateFrom: string | null;
  dateTo: string | null;
  sourceGroups: SourceGroup[];
  site?: {
    siteName: string;
    siteCommercialLinks?: {
      role: string;
      billingAllowed: boolean;
      customer: { id: string; name: string };
    }[];
  } | null;
};

// Order thread types
type OrderInvoiceMatch = {
  id: string;
  matchConfidence: number | null;
  matchMethod: string | null;
  invoiceLine: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    productDescription: string;
    normalizedProduct: string;
    qty: number;
    unit: string;
    rate: number | null;
    amount: number | null;
    billingConfidence: string;
    documentId: string | null;
    document: {
      id: string;
      invoiceNumber: string | null;
      invoiceDate: string | null;
      totalAmount: number | null;
      parseStatus: string;
    } | null;
  };
};

type OrderTicketLine = {
  id: string;
  caseId: string;
  orderThreadId: string | null;
  sourceMessageId: string | null;
  date: string;
  sender: string;
  rawText: string;
  normalizedProduct: string;
  requestedQty: number;
  requestedUnit: string;
  notes: string | null;
  status: string;
  invoiceMatches: OrderInvoiceMatch[];
};

type OrderThread = {
  id: string;
  caseId: string;
  label: string;
  description: string | null;
  messageIds: string[];
  orderLines: OrderTicketLine[];
};

type OrderMessage = {
  id: string;
  sourceId: string;
  parsedTimestamp: string;
  sender: string;
  rawText: string;
  hasMedia: boolean;
  mediaType: string | null;
  messageType: string;
  hasAttachment: boolean;
};

type OrderInvoiceDoc = {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  parseStatus: string;
  lines: Array<{
    id: string;
    productDescription: string;
    normalizedProduct: string;
    qty: number;
    unit: string;
    rate: number | null;
    amount: number | null;
  }>;
};

type OrderStats = {
  totalThreads: number;
  totalLines: number;
  invoicedCount: number;
  unmatchedCount: number;
  exceptionCount: number;
  messageLinkedCount: number;
  suggestedCount: number;
  unmatchedInvoiceLineCount: number;
  imageCount: number;
  invoicedPct: number;
};

type OrderMoney = {
  invoicedValue: number;
  unmatchedInvoiceValue: number;
  gapEstimateValue: number;
  gapUnknownLines: number;
};

type SuggestedInvoiceLine = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  productDescription: string;
  normalizedProduct: string;
  qty: number;
  unit: string;
  rate: number | null;
  amount: number | null;
  document: {
    id: string;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    totalAmount: number | null;
    parseStatus: string;
  } | null;
};

type SuggestedOrderLine = OrderTicketLine & {
  orderThread: { id: string; label: string } | null;
};

type UnmatchedInvoiceLine = SuggestedInvoiceLine;

type ImageMessage = {
  id: string;
  sourceId: string;
  lineNumber: number;
  parsedTimestamp: string;
  sender: string;
  rawText: string;
  hasMedia: boolean;
  mediaType: string | null;
  mediaFilename: string | null;
  mediaNote: string | null;
};

type ImageContext = {
  before: ImageMessage[];
  after: ImageMessage[];
};

const ORDER_LINE_STATUS_COLORS: Record<string, string> = {
  INVOICED: "text-[#00CC66] bg-[#00CC66]/10",
  UNMATCHED: "text-[#FF3333] bg-[#FF3333]/10",
  EXCEPTION: "text-[#FF9900] bg-[#FF9900]/10",
  MESSAGE_LINKED: "text-[#888888] bg-[#333333]",
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
  const [messages, setMessages] = useState(initialMessages);
  const [totalCount, setTotalCount] = useState(stats.messageCount);
  const [hasMore, setHasMore] = useState(initialMessages.length < stats.messageCount);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dbTotal, setDbTotal] = useState(stats.messageCount);
  const [pageSize, setPageSize] = useState(100);
  const [autoLoading, setAutoLoading] = useState(false);

  async function loadMore(customLimit?: number) {
    setLoadingMore(true);
    const params = new URLSearchParams({
      limit: String(customLimit || pageSize),
      offset: String(messages.length),
    });
    if (filterType !== "ALL") params.set("messageType", filterType);
    if (filterSender) params.set("sender", filterSender);
    if (filterSource !== "ALL") params.set("sourceId", filterSource);
    if (filterParsed !== "ALL") params.set("parsedOk", filterParsed === "PARSED" ? "true" : "false");

    const res = await fetch(`/api/backlog/cases/${backlogCase.id}/timeline?${params}`);
    if (res.ok) {
      const data = await res.json();
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const newMsgs = data.messages.filter((m: Message) => !existingIds.has(m.id));
        return [...prev, ...newMsgs];
      });
      setTotalCount(data.totalCount);
      setHasMore(data.hasMore);
      setDbTotal(data.stats?.dbTotal || data.totalCount);
    }
    setLoadingMore(false);
  }

  async function jumpToLatest() {
    setLoadingMore(true);
    const lastOffset = Math.max(0, totalCount - pageSize);
    const res = await fetch(`/api/backlog/cases/${backlogCase.id}/timeline?limit=${pageSize}&offset=${lastOffset}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages);
      setTotalCount(data.totalCount);
      setHasMore(false);
      setDbTotal(data.stats?.dbTotal || data.totalCount);
    }
    setLoadingMore(false);
  }

  async function loadAll() {
    setAutoLoading(true);
    setLoadingMore(true);
    let allMsgs: Message[] = [];
    let offset = 0;
    let more = true;
    while (more) {
      const params = new URLSearchParams({ limit: "500", offset: String(offset) });
      const res = await fetch(`/api/backlog/cases/${backlogCase.id}/timeline?${params}`);
      if (!res.ok) break;
      const data = await res.json();
      const existingIds = new Set(allMsgs.map((m) => m.id));
      const newMsgs = data.messages.filter((m: Message) => !existingIds.has(m.id));
      allMsgs = [...allMsgs, ...newMsgs];
      more = data.hasMore;
      offset += data.returnedCount;
      setMessages([...allMsgs]);
      setTotalCount(data.totalCount);
      setDbTotal(data.stats?.dbTotal || data.totalCount);
    }
    setHasMore(false);
    setAutoLoading(false);
    setLoadingMore(false);
  }

  async function jumpToOldest() {
    setLoadingMore(true);
    const res = await fetch(`/api/backlog/cases/${backlogCase.id}/timeline?limit=${pageSize}&offset=0`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages);
      setTotalCount(data.totalCount);
      setHasMore(data.hasMore);
      setDbTotal(data.stats?.dbTotal || data.totalCount);
    }
    setLoadingMore(false);
  }
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importSourceId, setImportSourceId] = useState("");
  const [importText, setImportText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [classifyingId, setClassifyingId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState("ALL");
  const [filterSender, setFilterSender] = useState("");
  const [filterSource, setFilterSource] = useState("ALL");

  // When source filter changes, re-fetch from server
  async function changeSourceFilter(srcId: string) {
    setFilterSource(srcId);
    setLoadingMore(true);
    const params = new URLSearchParams({ limit: String(pageSize), offset: "0" });
    if (srcId !== "ALL") params.set("sourceId", srcId);
    const res = await fetch(`/api/backlog/cases/${backlogCase.id}/timeline?${params}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages);
      setTotalCount(data.totalCount);
      setHasMore(data.hasMore);
      setDbTotal(data.stats?.dbTotal || data.totalCount);
    }
    setLoadingMore(false);
  }
  const [filterParsed, setFilterParsed] = useState("ALL");
  const [filterSearch, setFilterSearch] = useState("");
  const [searchTimer, setSearchTimer] = useState<NodeJS.Timeout | null>(null);

  function handleSearchChange(val: string) {
    setFilterSearch(val);
    if (searchTimer) clearTimeout(searchTimer);
    if (!val.trim()) {
      // Clear search — reload default
      changeSourceFilter(filterSource);
      return;
    }
    // Debounce 500ms then server search
    const timer = setTimeout(() => serverSearch(val), 500);
    setSearchTimer(timer);
  }

  async function serverSearch(query: string) {
    setLoadingMore(true);
    const params = new URLSearchParams({ limit: String(pageSize), offset: "0", search: query });
    if (filterSource !== "ALL") params.set("sourceId", filterSource);
    const res = await fetch(`/api/backlog/cases/${backlogCase.id}/timeline?${params}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages);
      setTotalCount(data.totalCount);
      setHasMore(data.hasMore);
      setDbTotal(data.stats?.dbTotal || data.totalCount);
    }
    setLoadingMore(false);
  }
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

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
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [uploadStatus, setUploadStatus] = useState<{
    filename: string; bytes: number; lineCount: number; status: string;
    parseStatus: string; parseProgressPct: number; messageCount: number; unparsedLines: number;
  } | null>(null);

  async function handleFileUpload() {
    const files = importFiles.length > 0 ? importFiles : importFile ? [importFile] : [];
    if (!importSourceId || files.length === 0) return;
    setSubmitting(true);

    // If multiple files, concatenate into one upload
    let blob: Blob;
    let filename: string;
    if (files.length === 1) {
      blob = files[0];
      filename = files[0].name;
    } else {
      const texts = await Promise.all(files.map((f) => f.text()));
      blob = new Blob([texts.join("\n")], { type: "text/plain" });
      filename = `merged_${files.length}_files.txt`;
    }

    const fd = new FormData();
    fd.append("file", blob, filename);

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

  const [linkingMsgId, setLinkingMsgId] = useState<string | null>(null);
  const [linkingRelType, setLinkingRelType] = useState<string | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<Message[]>([]);
  const [linkSearching, setLinkSearching] = useState(false);

  async function searchForLink(query: string) {
    setLinkSearch(query);
    if (!query.trim() || query.length < 2) { setLinkResults([]); return; }
    setLinkSearching(true);
    const res = await fetch(`/api/backlog/cases/${backlogCase.id}/timeline?search=${encodeURIComponent(query)}&limit=10`);
    if (res.ok) {
      const data = await res.json();
      setLinkResults(data.messages.filter((m: Message) => m.id !== linkingMsgId));
    }
    setLinkSearching(false);
  }

  async function classifyMessage(msgId: string, field: string, value: string) {
    // If setting a relation type other than NONE, enter linking mode
    if (field === "relationType" && value !== "NONE") {
      setLinkingMsgId(msgId);
      setLinkingRelType(value);
      setClassifyingId(null);
      return; // Don't save yet — wait for target click
    }

    await fetch(`/api/backlog/messages/${msgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value, ...(field === "relationType" && value === "NONE" ? { relatedMessageId: null } : {}) }),
    });
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, [field]: value } : m));
    setClassifyingId(null);
  }

  async function linkToMessage(targetMsgId: string) {
    if (!linkingMsgId || !linkingRelType) return;
    await fetch(`/api/backlog/messages/${linkingMsgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relationType: linkingRelType, relatedMessageId: targetMsgId }),
    });
    setMessages((prev) => prev.map((m) => m.id === linkingMsgId ? { ...m, relationType: linkingRelType!, relatedMessageId: targetMsgId } : m));
    setLinkingMsgId(null);
    setLinkingRelType(null);
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

  async function clearSource(srcId: string) {
    await fetch(`/api/backlog/sources/${srcId}/clear`, { method: "POST" });
    router.refresh();
  }

  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());

  function toggleSource(id: string) {
    setSelectedSources((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function bulkClearSources() {
    if (!confirm(`Clear import data from ${selectedSources.size} source(s)? Messages will be deleted but sources kept.`)) return;
    for (const id of selectedSources) {
      await fetch(`/api/backlog/sources/${id}/clear`, { method: "POST" });
    }
    setSelectedSources(new Set());
    router.refresh();
  }

  async function bulkDeleteSources() {
    if (!confirm(`DELETE ${selectedSources.size} source(s) and ALL their messages? This cannot be undone.`)) return;
    for (const id of selectedSources) {
      await fetch(`/api/backlog/sources/${id}`, { method: "DELETE" });
    }
    setSelectedSources(new Set());
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

  // Media upload state
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [mediaUploadSourceId, setMediaUploadSourceId] = useState<string | null>(null);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaUploadResult, setMediaUploadResult] = useState<{ uploaded: number } | null>(null);

  async function handleMediaUpload(sourceId: string, files: FileList | File[]) {
    if (!files || files.length === 0) return;
    setMediaUploading(true);
    setMediaUploadSourceId(sourceId);
    setMediaUploadResult(null);
    try {
      const fd = new FormData();
      for (const file of Array.from(files)) {
        fd.append("file", file);
      }
      fd.append("sourceId", sourceId);
      fd.append("siteId", backlogCase.siteId || "");
      const res = await fetch("/api/commercial/media/upload", { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        setMediaUploadResult(data);
      }
    } catch (err) {
      console.error("Media upload failed:", err);
    } finally {
      setMediaUploading(false);
    }
  }

  // Invoice upload state
  type InvoiceDoc = {
    id: string;
    sourceId: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    customerName: string | null;
    site: string | null;
    rawFileName: string;
    fileBytes: number;
    pageCount: number;
    parseStatus: string;
    parseError: string | null;
    totalAmount: number | null;
    lineCount: number;
    lines: Array<{
      id: string;
      productDescription: string;
      normalizedProduct: string;
      qty: number;
      unit: string;
      rate: number | null;
      amount: number | null;
      billingConfidence: string;
    }>;
  };
  const [invoiceDocs, setInvoiceDocs] = useState<InvoiceDoc[]>([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceUploading, setInvoiceUploading] = useState(false);
  const [invoiceDragOver, setInvoiceDragOver] = useState(false);
  const [invoiceUploadSourceId, setInvoiceUploadSourceId] = useState("");
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

  const invoiceFileRef = useRef<HTMLInputElement>(null);

  const documentSources = allSources.filter((s) =>
    ["PDF", "DOCUMENT", "INVOICE", "OTHER"].includes(s.sourceType.toUpperCase())
  );

  async function loadInvoiceDocs() {
    setInvoiceLoading(true);
    const allDocs: InvoiceDoc[] = [];
    for (const src of documentSources) {
      const res = await fetch(`/api/backlog/sources/${src.id}/upload-invoice`);
      if (res.ok) {
        const docs = await res.json();
        allDocs.push(...docs);
      }
    }
    setInvoiceDocs(allDocs);
    setInvoiceLoading(false);
  }

  async function deleteInvoiceDoc(docId: string, sourceId: string) {
    if (!confirm("Delete this invoice document and all its line items?")) return;
    await fetch(`/api/backlog/sources/${sourceId}/upload-invoice?documentId=${docId}`, { method: "DELETE" });
    setInvoiceDocs((prev) => prev.filter((d) => d.id !== docId));
  }

  async function deleteAllInvoiceDocs() {
    if (!confirm(`Delete ALL ${invoiceDocs.length} invoice documents and their line items?`)) return;
    for (const src of documentSources) {
      await fetch(`/api/backlog/sources/${src.id}/upload-invoice?all=true`, { method: "DELETE" });
    }
    setInvoiceDocs([]);
  }

  async function handleInvoiceUpload(files: File[]) {
    if (!invoiceUploadSourceId || files.length === 0) return;
    setInvoiceUploading(true);
    try {
      const fd = new FormData();
      for (const f of files) {
        fd.append("files", f);
      }
      const res = await fetch(`/api/backlog/sources/${invoiceUploadSourceId}/upload-invoice`, {
        method: "POST",
        body: fd,
      });
      if (res.ok) {
        await loadInvoiceDocs();
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Invoice upload failed:", err);
      }
    } catch (err) {
      console.error("Invoice upload error:", err);
    }
    setInvoiceUploading(false);
    // Reset file input so same file can be re-selected
    if (invoiceFileRef.current) invoiceFileRef.current.value = "";
  }

  function handleInvoiceDrop(e: React.DragEvent) {
    e.preventDefault();
    setInvoiceDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (files.length > 0) handleInvoiceUpload(files);
  }

  function handleInvoiceFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) handleInvoiceUpload(files);
  }

  const [runningMatch, setRunningMatch] = useState(false);
  const [matchResult, setMatchResult] = useState<{ matched: number; ticketLines: number; invoiceLines: number } | null>(null);

  async function runReconciliationMatch() {
    setRunningMatch(true);
    setMatchResult(null);
    const res = await fetch("/api/reconciliation/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: backlogCase.id }),
    });
    if (res.ok) {
      const data = await res.json();
      setMatchResult(data);
    }
    setRunningMatch(false);
  }
  // Orders tab state
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [orderThreads, setOrderThreads] = useState<OrderThread[]>([]);
  const [orderMessages, setOrderMessages] = useState<Record<string, OrderMessage>>({});
  const [orderSourceMap, setOrderSourceMap] = useState<Record<string, { label: string; sourceType: string }>>({});
  const [orderInvoiceDocs, setOrderInvoiceDocs] = useState<Record<string, OrderInvoiceDoc>>({});
  const [orderOrphanLines, setOrderOrphanLines] = useState<OrderTicketLine[]>([]);
  const [orderStats, setOrderStats] = useState<OrderStats>({ totalThreads: 0, totalLines: 0, invoicedCount: 0, unmatchedCount: 0, exceptionCount: 0, messageLinkedCount: 0, suggestedCount: 0, unmatchedInvoiceLineCount: 0, imageCount: 0, invoicedPct: 0 });
  const [orderMoney, setOrderMoney] = useState<OrderMoney>({ invoicedValue: 0, unmatchedInvoiceValue: 0, gapEstimateValue: 0, gapUnknownLines: 0 });
  const [suggestedLines, setSuggestedLines] = useState<SuggestedOrderLine[]>([]);
  const [suggestedInvoiceIndex, setSuggestedInvoiceIndex] = useState<Record<string, SuggestedInvoiceLine[]>>({});
  const [unmatchedInvoiceLines, setUnmatchedInvoiceLines] = useState<UnmatchedInvoiceLine[]>([]);
  const [imageMessages, setImageMessages] = useState<ImageMessage[]>([]);
  const [imageContext, setImageContext] = useState<Record<string, ImageContext>>({});
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(new Set());

  // Orders sub-tab view ("threads" | "gaps" | "review" | "images" | "unmatched-invoices")
  const [orderSubView, setOrderSubView] = useState<"threads" | "gaps" | "review" | "images" | "unmatched-invoices">("threads");

  // Thread filters
  const [threadFilter, setThreadFilter] = useState<"ALL" | "HAS_GAPS" | "FULLY_INVOICED" | "HAS_SUGGESTIONS" | "HAS_IMAGES">("ALL");
  const [threadSort, setThreadSort] = useState<"DATE" | "MOST_LINES" | "MOST_GAPS">("DATE");

  // Gaps filters
  const [gapsSourceFilter, setGapsSourceFilter] = useState<string>("ALL");
  const [gapsGroupByMonth, setGapsGroupByMonth] = useState<boolean>(true);

  // Unmatched-invoices manual link state
  const [manualLinkInvoiceId, setManualLinkInvoiceId] = useState<string | null>(null);
  const [manualLinkQuery, setManualLinkQuery] = useState<string>("");

  // Review action state
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);

  async function loadOrderThreads(force = false) {
    if (ordersLoaded && !force) return;
    setOrdersLoading(true);
    try {
      const res = await fetch(`/api/backlog/cases/${backlogCase.id}/orders`);
      if (res.ok) {
        const data = await res.json();
        setOrderThreads(data.threads);
        setOrderMessages(data.messages);
        setOrderSourceMap(data.sourceMap);
        setOrderInvoiceDocs(data.invoiceDocs);
        setOrderOrphanLines(data.orphanLines);
        setOrderStats(data.stats);
        setOrderMoney(data.money || { invoicedValue: 0, unmatchedInvoiceValue: 0, gapEstimateValue: 0, gapUnknownLines: 0 });
        setSuggestedLines(data.suggestedLines || []);
        setSuggestedInvoiceIndex(data.suggestedInvoiceIndex || {});
        setUnmatchedInvoiceLines(data.unmatchedInvoiceLines || []);
        setImageMessages(data.imageMessages || []);
        setImageContext(data.imageContext || {});
        setOrdersLoaded(true);
      }
    } catch (err) {
      console.error("Failed to load order threads:", err);
    }
    setOrdersLoading(false);
  }

  // ========================================================================
  // Review actions
  // ========================================================================
  function parseSuggestedInvoiceNumber(notes: string | null): string | null {
    if (!notes) return null;
    const m = /Possible match:\s*(INV[-\s]?[A-Za-z0-9\-_]+)/i.exec(notes);
    return m ? m[1].replace(/\s+/g, "").toUpperCase() : null;
  }

  function findSuggestedInvoiceLines(notes: string | null): SuggestedInvoiceLine[] {
    const key = parseSuggestedInvoiceNumber(notes);
    if (!key) return [];
    return suggestedInvoiceIndex[key] || [];
  }

  async function approveSuggestedMatch(ticketLineId: string, invoiceLineId: string) {
    setReviewBusyId(ticketLineId);
    try {
      const res = await fetch(`/api/backlog/lines/${ticketLineId}/approve-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceLineId }),
      });
      if (res.ok) {
        await loadOrderThreads(true);
      }
    } catch (err) {
      console.error("approve failed", err);
    }
    setReviewBusyId(null);
  }

  async function rejectSuggestedMatch(ticketLineId: string) {
    setReviewBusyId(ticketLineId);
    try {
      const res = await fetch(`/api/backlog/lines/${ticketLineId}/reject-match`, {
        method: "POST",
      });
      if (res.ok) {
        await loadOrderThreads(true);
      }
    } catch (err) {
      console.error("reject failed", err);
    }
    setReviewBusyId(null);
  }

  async function linkInvoiceToTicketLine(invoiceLineId: string, ticketLineId: string) {
    setReviewBusyId(invoiceLineId);
    try {
      const res = await fetch(`/api/backlog/invoice-lines/${invoiceLineId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketLineId }),
      });
      if (res.ok) {
        await loadOrderThreads(true);
        setManualLinkInvoiceId(null);
        setManualLinkQuery("");
      }
    } catch (err) {
      console.error("link failed", err);
    }
    setReviewBusyId(null);
  }

  // ========================================================================
  // Thread filter + sort helpers
  // ========================================================================
  function threadHasGaps(t: OrderThread): boolean {
    return t.orderLines.some((l) => l.status === "UNMATCHED");
  }
  function threadHasSuggestions(t: OrderThread): boolean {
    return t.orderLines.some((l) => l.notes && /Possible match: INV/i.test(l.notes));
  }
  function threadHasImages(t: OrderThread): boolean {
    return t.messageIds.some((id) => {
      const m = orderMessages[id];
      return !!(m && m.hasMedia && m.mediaType && m.mediaType.startsWith("image"));
    });
  }
  function threadIsFullyInvoiced(t: OrderThread): boolean {
    if (t.orderLines.length === 0) return false;
    return t.orderLines.every((l) => l.status === "INVOICED");
  }
  function threadEarliestDate(t: OrderThread): number {
    if (t.orderLines.length === 0) return 0;
    const times = t.orderLines.map((l) => new Date(l.date).getTime()).filter((n) => !isNaN(n));
    return times.length > 0 ? Math.min(...times) : 0;
  }
  function threadGapCount(t: OrderThread): number {
    return t.orderLines.filter((l) => l.status === "UNMATCHED").length;
  }

  const filteredSortedThreads = (() => {
    const filtered = orderThreads.filter((t) => {
      if (threadFilter === "ALL") return true;
      if (threadFilter === "HAS_GAPS") return threadHasGaps(t);
      if (threadFilter === "FULLY_INVOICED") return threadIsFullyInvoiced(t);
      if (threadFilter === "HAS_SUGGESTIONS") return threadHasSuggestions(t);
      if (threadFilter === "HAS_IMAGES") return threadHasImages(t);
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (threadSort === "DATE") return threadEarliestDate(a) - threadEarliestDate(b);
      if (threadSort === "MOST_LINES") return b.orderLines.length - a.orderLines.length;
      if (threadSort === "MOST_GAPS") return threadGapCount(b) - threadGapCount(a);
      return 0;
    });
  })();

  // All UNMATCHED ticket lines across everything (for Gaps view)
  const allUnmatchedLines: OrderTicketLine[] = (() => {
    const all: OrderTicketLine[] = [];
    for (const t of orderThreads) {
      for (const l of t.orderLines) if (l.status === "UNMATCHED") all.push(l);
    }
    for (const l of orderOrphanLines) if (l.status === "UNMATCHED") all.push(l);
    return all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  })();

  // Thread lookup for gaps view (ticket line -> thread)
  const threadByLineId: Record<string, { id: string; label: string }> = (() => {
    const map: Record<string, { id: string; label: string }> = {};
    for (const t of orderThreads) {
      for (const l of t.orderLines) map[l.id] = { id: t.id, label: t.label };
    }
    return map;
  })();

  // Source label lookup for a ticket line (via sourceMessageId)
  function lineSourceLabel(line: OrderTicketLine): string {
    if (!line.sourceMessageId) return "";
    const msg = orderMessages[line.sourceMessageId];
    if (!msg) return "";
    return orderSourceMap[msg.sourceId]?.label || "";
  }

  function lineSourceId(line: OrderTicketLine): string | null {
    if (!line.sourceMessageId) return null;
    const msg = orderMessages[line.sourceMessageId];
    return msg ? msg.sourceId : null;
  }

  function monthBucket(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }

  // GBP formatter
  const fmtGBP = (n: number) => `\u00A3${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  function toggleThread(threadId: string) {
    setExpandedThreadIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }

  function getThreadStatusSummary(thread: OrderThread) {
    const lines = thread.orderLines;
    const total = lines.length;
    const invoiced = lines.filter((l) => l.status === "INVOICED").length;
    const unmatched = lines.filter((l) => l.status === "UNMATCHED").length;
    const exception = lines.filter((l) => l.status === "EXCEPTION").length;

    if (exception > 0) return { text: `${total} lines — ${invoiced} invoiced, ${exception} exceptions`, color: "text-[#FF9900]", icon: "warn" };
    if (unmatched > 0) return { text: `${total} lines — ${invoiced} invoiced, ${unmatched} gaps`, color: "text-[#FF9900]", icon: "warn" };
    if (invoiced === total && total > 0) return { text: `${total} lines — ${invoiced} invoiced`, color: "text-[#00CC66]", icon: "ok" };
    return { text: `${total} lines — ${invoiced} invoiced`, color: "text-[#888888]", icon: "none" };
  }

  function getThreadInvoiceNumbers(thread: OrderThread): string[] {
    const nums = new Set<string>();
    for (const line of thread.orderLines) {
      for (const match of line.invoiceMatches) {
        if (match.invoiceLine.invoiceNumber) nums.add(match.invoiceLine.invoiceNumber);
      }
    }
    return [...nums];
  }

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
    // filterSearch is handled server-side, not client-side
    if (filterDateFrom) {
      const msgDate = new Date(m.parsedTimestamp);
      const fromDate = new Date(filterDateFrom);
      if (msgDate < fromDate) return false;
    }
    if (filterDateTo) {
      const msgDate = new Date(m.parsedTimestamp);
      const toDate = new Date(filterDateTo + "T23:59:59");
      if (msgDate > toDate) return false;
    }
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
          {backlogCase.site?.siteCommercialLinks && backlogCase.site.siteCommercialLinks.length > 0 && (
            <div className="flex items-center gap-2 ml-[72px] mt-0.5">
              <Users className="size-3 text-[#FF6600]" />
              {backlogCase.site.siteCommercialLinks.map((l, i) => (
                <span key={i} className="text-[10px] bb-mono text-[#E0E0E0]">
                  <span className="text-[#FF6600] font-bold">{l.customer.name}</span>
                  <span className="text-[#666666]"> ({l.role}{l.billingAllowed ? " · Billing" : ""})</span>
                </span>
              ))}
            </div>
          )}
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
                    <option value="PDF">PDF / Document</option>
                    <option value="INVOICE">Invoice</option>
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
                  <Label>Upload WhatsApp .txt Export File(s)</Label>
                  <input
                    type="file"
                    accept=".txt,.text"
                    multiple
                    onChange={(e) => setImportFiles(e.target.files ? Array.from(e.target.files) : [])}
                    className="w-full text-xs text-[#E0E0E0] file:bg-[#FF6600] file:text-black file:border-0 file:px-3 file:py-1.5 file:text-xs file:font-bold file:mr-3 file:cursor-pointer bg-[#222222] border border-[#333333] p-1"
                  />
                  <div className="text-[9px] text-[#666666]">
                    Select one or multiple .txt files. Each uploads to the selected source.<br/>
                    Files stored verbatim before parsing. Zero data loss.
                  </div>
                </div>

                {importFiles.length > 0 && !uploadStatus && (
                  <div className="text-[9px] text-[#888888] bb-mono">{importFiles.length} file(s) selected: {importFiles.map((f) => f.name).join(", ")}</div>
                )}

                {!uploadStatus && (
                  <Button onClick={handleFileUpload} disabled={submitting || !importSourceId || (importFiles.length === 0 && !importFile)} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                    {submitting ? "Uploading..." : `Upload & Parse${importFiles.length > 1 ? ` (${importFiles.length} files)` : ""}`}
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
          <TabsTrigger value="orders" onClick={() => { if (!ordersLoaded) loadOrderThreads(); }}>Orders ({orderStats.totalThreads})</TabsTrigger>
          <TabsTrigger value="invoices" onClick={() => { if (invoiceDocs.length === 0) loadInvoiceDocs(); }}>Invoices ({invoiceDocs.length})</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
        </TabsList>

        {/* TIMELINE TAB */}
        <TabsContent value="timeline" className="mt-4 space-y-3">
          {/* Loaded count + navigation + page size + date range */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs text-[#888888] bb-mono">
              Showing <span className="text-[#E0E0E0] font-bold">{filtered.length}</span> of <span className="text-[#E0E0E0] font-bold">{totalCount}</span> messages
              {filtered.length < messages.length && <span className="text-[#FF9900]"> (filtered)</span>}
              {hasMore && <span className="text-[#FF9900]"> (more available)</span>}
              {autoLoading && <span className="text-[#FF6600] animate-pulse"> loading all...</span>}
            </div>
            <div className="flex items-center gap-2">
              {/* Page size */}
              <span className="text-[8px] text-[#666666]">PER PAGE:</span>
              {[50, 100, 150, 200, 250].map((n) => (
                <button key={n} onClick={() => setPageSize(n)} className={`text-[9px] px-1.5 py-0.5 ${pageSize === n ? "bg-[#FF6600] text-black" : "text-[#888888] hover:text-[#E0E0E0]"}`}>{n}</button>
              ))}
              <span className="text-[#555555]">|</span>
              <button onClick={jumpToOldest} className="text-[9px] px-2 py-0.5 bg-[#222222] border border-[#333333] text-[#888888] hover:text-[#E0E0E0]">⇤ Oldest</button>
              <button onClick={jumpToLatest} className="text-[9px] px-2 py-0.5 bg-[#222222] border border-[#333333] text-[#888888] hover:text-[#E0E0E0]">Latest ⇥</button>
              <button onClick={loadAll} disabled={autoLoading || !hasMore} className="text-[9px] px-2 py-0.5 bg-[#FF6600] text-black hover:bg-[#FF9900] disabled:opacity-30">Load All</button>
            </div>
          </div>

          {/* Date range filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[8px] text-[#666666] uppercase tracking-widest">DATE:</span>
            <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="h-6 text-[10px] bg-[#222222] border border-[#333333] text-[#E0E0E0] px-1 bb-mono" />
            <span className="text-[8px] text-[#666666]">→</span>
            <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="h-6 text-[10px] bg-[#222222] border border-[#333333] text-[#E0E0E0] px-1 bb-mono" />
            <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 30); setFilterDateFrom(d.toISOString().slice(0,10)); setFilterDateTo(""); }} className="text-[8px] px-1.5 py-0.5 text-[#888888] hover:text-[#E0E0E0] bg-[#222222] border border-[#333333]">30d</button>
            <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 90); setFilterDateFrom(d.toISOString().slice(0,10)); setFilterDateTo(""); }} className="text-[8px] px-1.5 py-0.5 text-[#888888] hover:text-[#E0E0E0] bg-[#222222] border border-[#333333]">90d</button>
            <button onClick={() => { setFilterDateFrom(""); setFilterDateTo(""); }} className="text-[8px] px-1.5 py-0.5 text-[#888888] hover:text-[#E0E0E0] bg-[#222222] border border-[#333333]">All</button>
            {backlogCase.dateFrom && (
              <button onClick={() => setFilterDateFrom(backlogCase.dateFrom!.slice(0,10))} className="text-[8px] px-1.5 py-0.5 text-[#FF6600] hover:bg-[#FF6600]/10 bg-[#222222] border border-[#FF6600]/30">From Job Start</button>
            )}
          </div>

          {/* Debug Panel */}
          <details className="text-[9px] text-[#555555]">
            <summary className="cursor-pointer hover:text-[#888888]">DEBUG</summary>
            <div className="mt-1 border border-[#333333] bg-[#151515] p-2 bb-mono grid grid-cols-3 gap-2">
              <div>DB total: <span className="text-[#E0E0E0]">{dbTotal}</span></div>
              <div>API returned: <span className="text-[#E0E0E0]">{messages.length}</span></div>
              <div>UI rendered: <span className="text-[#E0E0E0]">{filtered.length}</span></div>
              <div>hasMore: <span className={hasMore ? "text-[#FF9900]" : "text-[#00CC66]"}>{String(hasMore)}</span></div>
              <div>totalCount: <span className="text-[#E0E0E0]">{totalCount}</span></div>
              <div>filters active: <span className="text-[#E0E0E0]">{[filterType !== "ALL", filterSender, filterSource !== "ALL", filterParsed !== "ALL"].filter(Boolean).length}</span></div>
            </div>
          </details>

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
            <button onClick={() => changeSourceFilter("ALL")} className={`text-[9px] px-2 py-0.5 ${filterSource === "ALL" ? "bg-[#FF6600] text-black" : "text-[#888888]"}`}>All</button>
            {allSources.map((s) => (
              <button key={s.id} onClick={() => changeSourceFilter(s.id)} className={`text-[9px] px-2 py-0.5 ${filterSource === s.id ? "bg-[#3399FF] text-black" : "text-[#888888]"}`}>{s.label.split(" ")[0]}</button>
            ))}
            <span className="text-[#555555]">|</span>
            <button onClick={() => setFilterParsed("ALL")} className={`text-[9px] px-2 py-0.5 ${filterParsed === "ALL" ? "bg-[#FF6600] text-black" : "text-[#888888]"}`}>All</button>
            <button onClick={() => setFilterParsed("PARSED")} className={`text-[9px] px-2 py-0.5 ${filterParsed === "PARSED" ? "bg-[#00CC66] text-black" : "text-[#888888]"}`}>Parsed</button>
            <button onClick={() => setFilterParsed("UNPARSED")} className={`text-[9px] px-2 py-0.5 ${filterParsed === "UNPARSED" ? "bg-[#FF9900] text-black" : "text-[#888888]"}`}>Unparsed</button>
            <span className="text-[#555555]">|</span>
            <Input value={filterSender} onChange={(e) => setFilterSender(e.target.value)}
              placeholder="Filter by sender..." className="h-6 w-40 text-[10px] bg-[#222222] border-[#333333]" />
            <span className="text-[#555555]">|</span>
            <Input value={filterSearch} onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search text..." className="h-6 w-48 text-[10px] bg-[#222222] border-[#FF6600]/50 focus:border-[#FF6600]" />
          </div>

          {/* Linking mode banner + cross-source search */}
          {linkingMsgId && (
            <div className="border border-[#FF6600] bg-[#FF6600]/10 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[#FF6600] font-bold bb-mono">
                  Click a message below OR search across all sources to link as <span className="text-white">{linkingRelType?.replace(/_/g, " ")}</span>
                </div>
                <button onClick={() => { setLinkingMsgId(null); setLinkingRelType(null); setLinkSearch(""); setLinkResults([]); }} className="text-[9px] text-[#888888] hover:text-[#E0E0E0] px-2 py-0.5 border border-[#333333]">Cancel</button>
              </div>
              <div className="flex items-center gap-2">
                <Input value={linkSearch} onChange={(e) => searchForLink(e.target.value)}
                  placeholder="Search across ALL sources (e.g. drylining, order)..." className="h-7 text-[10px] bg-[#222222] border-[#FF6600]/50 flex-1" />
                {linkSearching && <span className="text-[9px] text-[#FF6600] animate-pulse">searching...</span>}
              </div>
              {linkResults.length > 0 && (
                <div className="border border-[#333333] bg-[#151515] max-h-40 overflow-y-auto">
                  {linkResults.map((r) => (
                    <button key={r.id} onClick={() => { linkToMessage(r.id); setLinkSearch(""); setLinkResults([]); }}
                      className="w-full text-left px-3 py-1.5 border-b border-[#2A2A2A] hover:bg-[#FF6600]/10 text-xs">
                      <span className="text-[9px] text-[#666666] bb-mono">{new Date(r.parsedTimestamp).toLocaleDateString("en-GB")}</span>
                      {" "}
                      <span className="text-[#3399FF] font-bold">{r.sender}</span>
                      {" "}
                      <span className="text-[8px] text-[#555555]">{(r as Message & { sourceLabel?: string }).sourceLabel || ""}</span>
                      {" — "}
                      <span className="text-[#E0E0E0]">{r.rawText.slice(0, 80)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          {filtered.length === 0 ? (
            <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center text-[#888888]">
              No messages yet. Import messages from a source.
            </div>
          ) : (
            <div className="border border-[#333333] bg-[#1A1A1A]">
              {filtered.map((msg) => (
                <div
                  key={msg.id}
                  onClick={linkingMsgId && linkingMsgId !== msg.id ? () => linkToMessage(msg.id) : undefined}
                  className={`border-b border-[#2A2A2A] px-3 py-2 hover:bg-[#1E1E1E] ${msg.relationType === "DUPLICATE_OF" ? "opacity-50" : ""} ${!msg.parsedOk ? "border-l-2 border-l-[#FF9900]" : ""} ${linkingMsgId && linkingMsgId !== msg.id ? "cursor-pointer hover:border-l-2 hover:border-l-[#FF6600] hover:bg-[#FF6600]/5" : ""} ${linkingMsgId === msg.id ? "border-l-2 border-l-[#FF6600] bg-[#FF6600]/10" : ""} ${msg.relatedMessageId ? "border-l-2 border-l-[#3399FF]" : ""}`}>
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
                        {msg.relationType !== "NONE" && (
                          <button onClick={(e) => { e.stopPropagation(); setLinkingMsgId(msg.id); setLinkingRelType(msg.relationType); }} className="cursor-pointer">
                            <Badge className={`text-[7px] px-1 py-0 ${msg.relatedMessageId ? "text-[#00CC66] bg-[#00CC66]/10" : "text-[#FF9900] bg-[#FF9900]/10 animate-pulse"}`}>
                              {msg.relationType.replace(/_/g, " ")}
                              {msg.relatedMessageId ? (() => {
                                const linked = messages.find((m) => m.id === msg.relatedMessageId);
                                return linked ? ` → ${linked.sender}: ${linked.rawText.slice(0, 30)}...` : " → (linked)";
                              })() : " ⚠ click to link"}
                            </Badge>
                          </button>
                        )}
                      </div>
                      <div className="text-xs text-[#E0E0E0] whitespace-pre-wrap">{msg.rawText}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {classifyingId === msg.id ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex gap-0.5 flex-wrap">
                            <span className="text-[6px] text-[#555555] w-8">TYPE:</span>
                            {MSG_TYPES.filter((t) => t !== "UNCLASSIFIED").map((t) => {
                              const isActive = msg.messageType === t;
                              return (
                              <button key={t} onClick={() => classifyMessage(msg.id, "messageType", t)}
                                className={`text-[7px] px-1.5 py-0.5 uppercase tracking-wider border ${isActive ? "border-white ring-1 ring-white font-black" : "border-transparent"} ${MSG_TYPE_COLORS[t] || "text-[#888888] bg-[#333333]"}`}>
                                {isActive ? "✓ " : ""}{t}
                              </button>
                              );
                            })}
                          </div>
                          <div className="flex gap-0.5 flex-wrap">
                            <span className="text-[6px] text-[#555555] w-8">REL:</span>
                            {["NONE", "DUPLICATE_OF", "FOLLOW_UP_TO", "CONFIRMATION_OF"].map((r) => {
                              const isActive = msg.relationType === r;
                              return (
                              <button key={r} onClick={() => classifyMessage(msg.id, "relationType", r)}
                                className={`text-[7px] px-1.5 py-0.5 uppercase tracking-wider border ${isActive ? "border-white ring-1 ring-white text-white bg-[#3399FF] font-black" : "border-transparent text-[#3399FF] bg-[#3399FF]/10"}`}>
                                {isActive ? "✓ " : ""}{r.replace(/_/g, " ")}
                              </button>
                              );
                            })}
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

          {/* Load More */}
          {hasMore && (
            <div className="text-center py-3">
              <Button onClick={() => loadMore()} disabled={loadingMore} variant="outline" className="bg-[#222222] border-[#333333] text-[#E0E0E0]">
                {loadingMore ? "Loading..." : `Load More (${totalCount - messages.length} remaining)`}
              </Button>
            </div>
          )}
          {!hasMore && messages.length > 0 && (
            <div className="text-center py-2 text-[9px] text-[#555555] bb-mono">
              All {totalCount} messages loaded
            </div>
          )}
        </TabsContent>

        {/* SOURCES TAB */}
        <TabsContent value="sources" className="mt-4 space-y-3">
          {/* Bulk action bar */}
          {selectedSources.size > 0 && (
            <div className="flex items-center gap-2 border border-[#3399FF]/30 bg-[#3399FF]/5 px-3 py-2">
              <span className="text-xs text-[#3399FF] bb-mono font-bold">{selectedSources.size} selected</span>
              <Button size="sm" onClick={bulkClearSources} variant="outline" className="bg-[#222222] text-[#FF9900] border-[#FF9900]/30 hover:bg-[#FF9900]/10">
                Clear Import Data
              </Button>
              <Button size="sm" onClick={bulkDeleteSources} variant="outline" className="bg-[#222222] text-[#FF3333] border-[#FF3333]/30 hover:bg-[#FF3333]/10">
                <Trash2 className="size-3 mr-1" />Delete Sources
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedSources(new Set())} className="bg-[#222222] border-[#333333] text-[#888888]">
                Clear Selection
              </Button>
            </div>
          )}

          {backlogCase.sourceGroups.map((g) => (
            <div key={g.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={g.sources.every((s) => selectedSources.has(s.id))}
                  onChange={() => {
                    const allIds = g.sources.map((s) => s.id);
                    const allSelected = allIds.every((id) => selectedSources.has(id));
                    setSelectedSources((prev) => {
                      const next = new Set(prev);
                      allIds.forEach((id) => allSelected ? next.delete(id) : next.add(id));
                      return next;
                    });
                  }}
                  className="accent-[#3399FF]"
                />
                <div className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">{g.sourceType}: {g.name}</div>
              </div>
              {g.sources.map((s) => (
                <div key={s.id} className={`border ${selectedSources.has(s.id) ? "border-[#3399FF]" : "border-[#333333]"} bg-[#1A1A1A] p-3 flex items-center justify-between`}>
                  <div className="flex items-center gap-3">
                    <input type="checkbox" checked={selectedSources.has(s.id)} onChange={() => toggleSource(s.id)} className="accent-[#3399FF]" />
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
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[9px] ${s.status === "IMPORTED" || s.status === "PARSED" ? "text-[#00CC66] bg-[#00CC66]/10" : "text-[#FF9900] bg-[#FF9900]/10"}`}>{s.status}</Badge>
                    {s._count.messages > 0 && (
                      <button onClick={() => clearSource(s.id)} className="p-0.5 hover:bg-[#FF9900]/10" title="Clear import data"><Upload className="size-3 text-[#FF9900]" /></button>
                    )}
                    {editingSourceId === s.id ? (
                      <div className="flex items-center gap-1">
                        <input value={editingSourceLabel} onChange={(e) => setEditingSourceLabel(e.target.value)} className="h-6 w-32 text-xs bg-[#222222] border border-[#FF6600] text-[#E0E0E0] px-1" onKeyDown={(e) => { if (e.key === "Enter") { editSourceLabel(s.id, editingSourceLabel); setEditingSourceId(null); } }} autoFocus />
                        <button onClick={() => { editSourceLabel(s.id, editingSourceLabel); setEditingSourceId(null); }} className="p-0.5 hover:bg-[#FF6600]/10"><Pencil className="size-3 text-[#FF6600]" /></button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingSourceId(s.id); setEditingSourceLabel(s.label); }} className="p-0.5 hover:bg-[#FF6600]/10" title="Edit label"><Pencil className="size-3 text-[#888888]" /></button>
                    )}
                    <label className="p-0.5 hover:bg-[#AA66FF]/10 cursor-pointer" title="Attach media files (images, PDFs, voice notes)">
                      <Image className="size-3 text-[#AA66FF]" />
                      <input
                        type="file"
                        multiple
                        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.mp3,.m4a,.ogg,.opus,.mp4,.mov"
                        className="hidden"
                        onChange={(e) => { if (e.target.files) handleMediaUpload(s.id, e.target.files); e.target.value = ""; }}
                      />
                    </label>
                    <button onClick={() => deleteSource(s.id, s.label)} className="p-0.5 hover:bg-[#FF3333]/10" title="Delete source"><Trash2 className="size-3 text-[#FF3333]" /></button>
                  </div>
                  {/* Media upload feedback */}
                  {mediaUploadSourceId === s.id && mediaUploading && (
                    <div className="mt-1 text-[9px] text-[#AA66FF] bb-mono flex items-center gap-1">
                      <Loader2 className="size-3 animate-spin" /> Uploading media...
                    </div>
                  )}
                  {mediaUploadSourceId === s.id && mediaUploadResult && (
                    <div className="mt-1 text-[9px] text-[#00CC66] bb-mono flex items-center gap-1">
                      <CheckCircle2 className="size-3" /> {mediaUploadResult.uploaded} media file{mediaUploadResult.uploaded !== 1 ? "s" : ""} uploaded — review in Commercial → Media Evidence
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </TabsContent>

        {/* ORDERS TAB */}
        <TabsContent value="orders" className="mt-4 space-y-4">
          {ordersLoading && (
            <div className="flex items-center justify-center gap-2 text-[#888888] py-8">
              <Loader2 className="size-4 animate-spin" /> Loading order threads...
            </div>
          )}

          {!ordersLoading && ordersLoaded && (
            <>
              {/* ============================================================ */}
              {/* MONEY ON THE TABLE — headline card */}
              {/* ============================================================ */}
              <div className="border border-[#FF6600]/40 bg-[#1A1A1A] p-4">
                <div className="text-[10px] uppercase tracking-[0.3em] text-[#FF6600] font-bold mb-3">
                  MONEY ON THE TABLE
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="size-4 text-[#00CC66]" />
                      <span className="text-[9px] uppercase tracking-widest text-[#888888]">INVOICED</span>
                    </div>
                    <div className="text-2xl font-bold bb-mono text-[#00CC66] mt-1">{fmtGBP(orderMoney.invoicedValue)}</div>
                    <div className="text-[9px] text-[#666666] bb-mono mt-0.5">
                      Sum of matched invoice line amounts
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <AlertCircle className="size-4 text-[#FF9900]" />
                      <span className="text-[9px] uppercase tracking-widest text-[#888888]">UNMATCHED INVOICES</span>
                    </div>
                    <div className="text-2xl font-bold bb-mono text-[#FF9900] mt-1">{fmtGBP(orderMoney.unmatchedInvoiceValue)}</div>
                    <div className="text-[9px] text-[#666666] bb-mono mt-0.5">
                      {orderStats.unmatchedInvoiceLineCount} invoice lines need review
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <AlertCircle className="size-4 text-[#FF3333]" />
                      <span className="text-[9px] uppercase tracking-widest text-[#888888]">GAP ESTIMATE</span>
                    </div>
                    <div className="text-2xl font-bold bb-mono text-[#FF3333] mt-1">{fmtGBP(orderMoney.gapEstimateValue)}</div>
                    <div className="text-[9px] text-[#666666] bb-mono mt-0.5">
                      {orderStats.unmatchedCount} unmatched order lines
                      {orderMoney.gapUnknownLines > 0 && ` · ${orderMoney.gapUnknownLines} unknown`}
                    </div>
                  </div>
                </div>
              </div>

              {/* ============================================================ */}
              {/* COUNT STATS */}
              {/* ============================================================ */}
              <div className="grid grid-cols-8 gap-3">
                <div className="border border-[#333333] bg-[#1A1A1A] p-3">
                  <div className="flex items-center gap-2"><ShoppingCart className="size-4 text-[#FF6600]" /><span className="text-[9px] uppercase tracking-widest text-[#888888]">THREADS</span></div>
                  <div className="text-lg font-bold bb-mono text-[#E0E0E0] mt-1">{orderStats.totalThreads}</div>
                </div>
                <div className="border border-[#333333] bg-[#1A1A1A] p-3">
                  <div className="flex items-center gap-2"><Package className="size-4 text-[#3399FF]" /><span className="text-[9px] uppercase tracking-widest text-[#888888]">TOTAL LINES</span></div>
                  <div className="text-lg font-bold bb-mono text-[#E0E0E0] mt-1">{orderStats.totalLines}</div>
                </div>
                <div className="border border-[#333333] bg-[#1A1A1A] p-3">
                  <div className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#00CC66]" /><span className="text-[9px] uppercase tracking-widest text-[#888888]">INVOICED</span></div>
                  <div className="text-lg font-bold bb-mono text-[#00CC66] mt-1">{orderStats.invoicedCount}</div>
                  <div className="text-[9px] text-[#666666] bb-mono mt-0.5">{orderStats.invoicedPct}% of total</div>
                </div>
                <div className="border border-[#333333] bg-[#1A1A1A] p-3">
                  <div className="flex items-center gap-2"><AlertCircle className="size-4 text-[#FF3333]" /><span className="text-[9px] uppercase tracking-widest text-[#888888]">GAPS</span></div>
                  <div className="text-lg font-bold bb-mono text-[#FF3333] mt-1">{orderStats.unmatchedCount}</div>
                </div>
                <div className="border border-[#333333] bg-[#1A1A1A] p-3">
                  <div className="flex items-center gap-2"><AlertCircle className="size-4 text-[#9966FF]" /><span className="text-[9px] uppercase tracking-widest text-[#888888]">EXCEPTIONS</span></div>
                  <div className="text-lg font-bold bb-mono text-[#9966FF] mt-1">{orderStats.exceptionCount}</div>
                </div>
                <div className="border border-[#333333] bg-[#1A1A1A] p-3">
                  <div className="flex items-center gap-2"><AlertCircle className="size-4 text-[#FF9900]" /><span className="text-[9px] uppercase tracking-widest text-[#888888]">SUGGESTED</span></div>
                  <div className="text-lg font-bold bb-mono text-[#FF9900] mt-1">{orderStats.suggestedCount}</div>
                </div>
                <div className="border border-[#333333] bg-[#1A1A1A] p-3">
                  <div className="flex items-center gap-2"><Image className="size-4 text-[#AA66FF]" /><span className="text-[9px] uppercase tracking-widest text-[#888888]">IMAGES</span></div>
                  <div className="text-lg font-bold bb-mono text-[#AA66FF] mt-1">{orderStats.imageCount}</div>
                </div>
                <div className="border border-[#333333] bg-[#1A1A1A] p-3">
                  <div className="flex items-center gap-2"><FileText className="size-4 text-[#FF9900]" /><span className="text-[9px] uppercase tracking-widest text-[#888888]">UNMATCHED INV</span></div>
                  <div className="text-lg font-bold bb-mono text-[#FF9900] mt-1">{orderStats.unmatchedInvoiceLineCount}</div>
                </div>
              </div>

              {/* ============================================================ */}
              {/* SUB-NAV */}
              {/* ============================================================ */}
              <div className="flex gap-1 border-b border-[#333333]">
                {([
                  { k: "threads", label: "THREADS", count: orderStats.totalThreads },
                  { k: "gaps", label: "GAPS", count: allUnmatchedLines.length },
                  { k: "review", label: "REVIEW", count: orderStats.suggestedCount },
                  { k: "images", label: "IMAGES", count: orderStats.imageCount },
                  { k: "unmatched-invoices", label: "UNMATCHED INVOICES", count: orderStats.unmatchedInvoiceLineCount },
                ] as const).map((it) => (
                  <button
                    key={it.k}
                    onClick={() => setOrderSubView(it.k)}
                    className={`px-3 py-2 text-[10px] uppercase tracking-widest font-bold border-b-2 transition-colors ${
                      orderSubView === it.k
                        ? "text-[#FF6600] border-[#FF6600]"
                        : "text-[#888888] border-transparent hover:text-[#E0E0E0]"
                    }`}
                  >
                    {it.label} <span className="text-[#555555]">({it.count})</span>
                  </button>
                ))}
              </div>

              {/* ============================================================ */}
              {/* SUB-VIEW: THREADS */}
              {/* ============================================================ */}
              {orderSubView === "threads" && (
                <>
                  {/* Thread filters */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] uppercase tracking-widest text-[#888888]">SHOW:</span>
                      {([
                        { k: "ALL", label: "All" },
                        { k: "HAS_GAPS", label: "Has Gaps" },
                        { k: "FULLY_INVOICED", label: "Fully Invoiced" },
                        { k: "HAS_SUGGESTIONS", label: "Has Suggestions" },
                        { k: "HAS_IMAGES", label: "Has Images" },
                      ] as const).map((f) => (
                        <button
                          key={f.k}
                          onClick={() => setThreadFilter(f.k)}
                          className={`px-2 py-0.5 text-[9px] border ${
                            threadFilter === f.k
                              ? "bg-[#FF6600] text-black border-[#FF6600]"
                              : "bg-[#222222] text-[#E0E0E0] border-[#333333] hover:border-[#FF6600]"
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] uppercase tracking-widest text-[#888888]">SORT:</span>
                      {([
                        { k: "DATE", label: "Date" },
                        { k: "MOST_LINES", label: "Most Lines" },
                        { k: "MOST_GAPS", label: "Most Gaps" },
                      ] as const).map((s) => (
                        <button
                          key={s.k}
                          onClick={() => setThreadSort(s.k)}
                          className={`px-2 py-0.5 text-[9px] border ${
                            threadSort === s.k
                              ? "bg-[#FF6600] text-black border-[#FF6600]"
                              : "bg-[#222222] text-[#E0E0E0] border-[#333333] hover:border-[#FF6600]"
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <div className="text-[9px] text-[#666666] ml-auto">
                      Showing {filteredSortedThreads.length} of {orderThreads.length}
                    </div>
                  </div>

                  {/* Thread Cards */}
                  {orderThreads.length === 0 && orderOrphanLines.length === 0 && (
                    <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center text-[#888888] text-sm">
                      No order threads found for this case. Run order reconstruction first.
                    </div>
                  )}

              {filteredSortedThreads.map((thread) => {
                const isExpanded = expandedThreadIds.has(thread.id);
                const statusSummary = getThreadStatusSummary(thread);
                const invoiceNums = getThreadInvoiceNumbers(thread);

                // Collect unique invoice documents for this thread
                const threadDocIds = new Set<string>();
                for (const line of thread.orderLines) {
                  for (const match of line.invoiceMatches) {
                    if (match.invoiceLine.documentId) threadDocIds.add(match.invoiceLine.documentId);
                  }
                }
                const threadDocs = [...threadDocIds].map((id) => orderInvoiceDocs[id]).filter(Boolean);

                return (
                  <div key={thread.id} id={`thread-${thread.id}`} className="border border-[#333333] bg-[#1A1A1A]">
                    {/* Thread Header */}
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[#222222] transition-colors"
                      onClick={() => toggleThread(thread.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {isExpanded ? <ChevronDown className="size-4 text-[#888888] shrink-0" /> : <ChevronRight className="size-4 text-[#888888] shrink-0" />}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-[#E0E0E0]">{thread.label}</span>
                            <span className={`text-[10px] bb-mono ${statusSummary.color}`}>
                              {statusSummary.text}
                              {statusSummary.icon === "ok" && " \u2705"}
                              {statusSummary.icon === "warn" && " \u26A0\uFE0F"}
                            </span>
                          </div>
                          {thread.description && (
                            <div className="text-[9px] text-[#666666] mt-0.5 truncate">{thread.description}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {invoiceNums.map((inv) => (
                          <Badge key={inv} className="text-[8px] px-1.5 py-0.5 text-[#3399FF] bg-[#3399FF]/10">{inv}</Badge>
                        ))}
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="border-t border-[#333333]">
                        {/* Section A: Source Messages */}
                        <div className="px-4 py-3 space-y-2 bg-[#151515]">
                          <div className="text-[10px] uppercase tracking-widest text-[#FF6600] font-bold flex items-center gap-2">
                            <MessageSquare className="size-3.5" /> SOURCE MESSAGES ({thread.messageIds.length})
                          </div>
                          {thread.messageIds.length === 0 ? (
                            <div className="text-[9px] text-[#666666] italic">No linked messages</div>
                          ) : (
                            <div className="border border-[#2A2A2A] bg-[#1A1A1A]">
                              {thread.messageIds
                                .map((mid) => orderMessages[mid])
                                .filter(Boolean)
                                .sort((a, b) => new Date(a.parsedTimestamp).getTime() - new Date(b.parsedTimestamp).getTime())
                                .map((msg) => {
                                  const srcLabel = orderSourceMap[msg.sourceId]?.label || "";
                                  // Color coding based on message type
                                  const msgBgClass =
                                    msg.messageType === "ORDER" ? "border-l-2 border-l-[#FF6600]" :
                                    msg.messageType === "CONFIRMATION" ? "border-l-2 border-l-[#00CC66]" :
                                    msg.messageType === "DELIVERY" ? "border-l-2 border-l-[#9966FF]" :
                                    (msg.rawText.toLowerCase().includes("wrong") || msg.rawText.toLowerCase().includes("issue") || msg.rawText.toLowerCase().includes("problem") || msg.rawText.toLowerCase().includes("damaged"))
                                      ? "border-l-2 border-l-[#FF3333]"
                                      : "";

                                  return (
                                    <div key={msg.id} className={`px-3 py-2 border-b border-[#2A2A2A] last:border-b-0 ${msgBgClass}`}>
                                      <div className="flex items-center gap-2 mb-0.5">
                                        <span className="text-[9px] bb-mono text-[#666666]">
                                          {new Date(msg.parsedTimestamp).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                        <span className="text-[10px] font-bold text-[#3399FF]">{msg.sender}</span>
                                        <span className="text-[8px] text-[#555555]">{srcLabel}</span>
                                        {msg.hasMedia && msg.mediaType?.startsWith("image") && (
                                          <Badge className="text-[7px] px-1 py-0 text-[#FF9900] bg-[#FF9900]/10">IMAGE</Badge>
                                        )}
                                        {msg.hasMedia && (msg.mediaType === "audio" || msg.mediaType?.startsWith("audio")) && (
                                          <Badge className="text-[7px] px-1 py-0 text-[#AA66FF] bg-[#AA66FF]/10">VOICE</Badge>
                                        )}
                                        {msg.hasAttachment && !msg.hasMedia && (
                                          <Paperclip className="size-2.5 text-[#FF9900]" />
                                        )}
                                      </div>
                                      <div className="text-xs text-[#E0E0E0] whitespace-pre-wrap">{msg.rawText}</div>
                                    </div>
                                  );
                                })}
                            </div>
                          )}
                        </div>

                        {/* Section B: Extracted Line Items */}
                        <div className="px-4 py-3 space-y-2 border-t border-[#333333]">
                          <div className="text-[10px] uppercase tracking-widest text-[#FF6600] font-bold flex items-center gap-2">
                            <Package className="size-3.5" /> EXTRACTED LINE ITEMS ({thread.orderLines.length})
                          </div>
                          {thread.orderLines.length === 0 ? (
                            <div className="text-[9px] text-[#666666] italic">No extracted line items</div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-[8px] uppercase tracking-widest text-[#666666] border-b border-[#333333]">
                                    <th className="text-left px-2 py-1.5 w-8">#</th>
                                    <th className="text-left px-2 py-1.5">Description</th>
                                    <th className="text-left px-2 py-1.5 w-36">Product</th>
                                    <th className="text-right px-2 py-1.5 w-14">Qty</th>
                                    <th className="text-left px-2 py-1.5 w-12">Unit</th>
                                    <th className="text-left px-2 py-1.5 w-24">Status</th>
                                    <th className="text-left px-2 py-1.5 w-28">Invoice Ref</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {thread.orderLines.map((line, idx) => {
                                    const isFromImage = line.sourceMessageId ? (() => {
                                      const srcMsg = orderMessages[line.sourceMessageId];
                                      return srcMsg?.hasMedia && srcMsg?.mediaType?.startsWith("image");
                                    })() : false;
                                    const invoiceRefs = line.invoiceMatches.map((m) => m.invoiceLine.invoiceNumber).filter(Boolean);

                                    return (
                                      <tr key={line.id} className="border-b border-[#2A2A2A] hover:bg-[#1E1E1E]">
                                        <td className="px-2 py-1.5 text-[#666666] bb-mono">{idx + 1}</td>
                                        <td className="px-2 py-1.5">
                                          <div className="text-[#E0E0E0]">{line.rawText}</div>
                                          {line.notes && <div className="text-[9px] text-[#888888] mt-0.5 italic">{line.notes}</div>}
                                          {isFromImage && (
                                            <Badge className="text-[7px] px-1 py-0 mt-0.5 text-[#FF9900] bg-[#FF9900]/10">[From image -- NEEDS REVIEW]</Badge>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5">
                                          <Badge className={`text-[7px] px-1 py-0 ${
                                            line.normalizedProduct !== "UNKNOWN" ? "text-[#00CC66] bg-[#00CC66]/10" : "text-[#FF3333] bg-[#FF3333]/10"
                                          }`}>
                                            {line.normalizedProduct}
                                          </Badge>
                                        </td>
                                        <td className="px-2 py-1.5 text-right bb-mono text-[#E0E0E0]">{Number(line.requestedQty)}</td>
                                        <td className="px-2 py-1.5 text-[#888888]">{line.requestedUnit}</td>
                                        <td className="px-2 py-1.5">
                                          <Badge className={`text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${ORDER_LINE_STATUS_COLORS[line.status] || "text-[#888888] bg-[#333333]"}`}>
                                            {line.status}
                                          </Badge>
                                        </td>
                                        <td className="px-2 py-1.5">
                                          {invoiceRefs.length > 0 ? (
                                            <div className="flex flex-wrap gap-1">
                                              {[...new Set(invoiceRefs)].map((ref) => (
                                                <Badge key={ref} className="text-[7px] px-1 py-0 text-[#3399FF] bg-[#3399FF]/10">{ref}</Badge>
                                              ))}
                                            </div>
                                          ) : (
                                            <span className="text-[9px] text-[#555555]">--</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>

                        {/* Section C: Invoice Match */}
                        {threadDocs.length > 0 && (
                          <div className="px-4 py-3 space-y-3 border-t border-[#333333] bg-[#151515]">
                            <div className="text-[10px] uppercase tracking-widest text-[#FF6600] font-bold flex items-center gap-2">
                              <FileText className="size-3.5" /> INVOICE MATCH
                            </div>
                            {threadDocs.map((doc) => {
                              // Get the invoice lines that matched this thread's order lines
                              const matchedInvoiceLineIds = new Set<string>();
                              for (const orderLine of thread.orderLines) {
                                for (const m of orderLine.invoiceMatches) {
                                  if (m.invoiceLine.documentId === doc.id) {
                                    matchedInvoiceLineIds.add(m.invoiceLine.id);
                                  }
                                }
                              }

                              return (
                                <div key={doc.id} className="border border-[#333333] bg-[#1A1A1A] p-3 space-y-3">
                                  {/* Invoice header */}
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                      <div>
                                        <span className="text-[9px] text-[#888888] uppercase tracking-widest">Invoice #</span>
                                        <div className="text-sm text-[#E0E0E0] font-bold">{doc.invoiceNumber || "--"}</div>
                                      </div>
                                      <div>
                                        <span className="text-[9px] text-[#888888] uppercase tracking-widest">Date</span>
                                        <div className="text-xs text-[#E0E0E0]">{doc.invoiceDate ? new Date(doc.invoiceDate).toLocaleDateString("en-GB") : "--"}</div>
                                      </div>
                                      <div>
                                        <span className="text-[9px] text-[#888888] uppercase tracking-widest">Total</span>
                                        <div className="text-xs text-[#E0E0E0] font-bold bb-mono">
                                          {doc.totalAmount != null ? `\u00A3${Number(doc.totalAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : "--"}
                                        </div>
                                      </div>
                                    </div>
                                    <Badge className={`text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${
                                      doc.parseStatus === "PARSED" ? "text-[#00CC66] bg-[#00CC66]/10" : "text-[#FF9900] bg-[#FF9900]/10"
                                    }`}>
                                      {doc.parseStatus}
                                    </Badge>
                                  </div>

                                  {/* Side by side: Order Lines vs Invoice Lines */}
                                  <div className="grid grid-cols-2 gap-3">
                                    {/* Order Lines */}
                                    <div>
                                      <div className="text-[8px] uppercase tracking-widest text-[#888888] mb-1 font-bold">ORDER LINES</div>
                                      <div className="border border-[#2A2A2A] bg-[#151515]">
                                        {thread.orderLines
                                          .filter((ol) => ol.invoiceMatches.some((m) => m.invoiceLine.documentId === doc.id))
                                          .map((ol) => (
                                            <div key={ol.id} className="px-2 py-1.5 border-b border-[#2A2A2A] last:border-b-0 text-[10px]">
                                              <div className="flex items-center justify-between">
                                                <span className="text-[#E0E0E0] truncate">{ol.normalizedProduct}</span>
                                                <span className="bb-mono text-[#E0E0E0] shrink-0 ml-2">{Number(ol.requestedQty)} {ol.requestedUnit}</span>
                                              </div>
                                              <Badge className={`text-[6px] mt-0.5 px-1 py-0 ${ORDER_LINE_STATUS_COLORS[ol.status] || "text-[#888888] bg-[#333333]"}`}>
                                                {ol.status}
                                              </Badge>
                                            </div>
                                          ))}
                                        {thread.orderLines.filter((ol) => ol.invoiceMatches.some((m) => m.invoiceLine.documentId === doc.id)).length === 0 && (
                                          <div className="px-2 py-2 text-[9px] text-[#555555] italic">No matched order lines</div>
                                        )}
                                      </div>
                                    </div>

                                    {/* Invoice Lines */}
                                    <div>
                                      <div className="text-[8px] uppercase tracking-widest text-[#888888] mb-1 font-bold">INVOICE LINES</div>
                                      <div className="border border-[#2A2A2A] bg-[#151515]">
                                        {doc.lines.map((il) => {
                                          const isMatched = matchedInvoiceLineIds.has(il.id);
                                          return (
                                            <div key={il.id} className={`px-2 py-1.5 border-b border-[#2A2A2A] last:border-b-0 text-[10px] ${isMatched ? "border-l-2 border-l-[#00CC66]" : "border-l-2 border-l-[#FF3333]"}`}>
                                              <div className="flex items-center justify-between">
                                                <span className={`truncate ${isMatched ? "text-[#E0E0E0]" : "text-[#FF3333]"}`}>{il.normalizedProduct || il.productDescription}</span>
                                                <span className="bb-mono text-[#E0E0E0] shrink-0 ml-2">{Number(il.qty)} {il.unit}</span>
                                              </div>
                                              {il.amount != null && (
                                                <span className="text-[9px] bb-mono text-[#888888]">{`\u00A3${Number(il.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`}</span>
                                              )}
                                            </div>
                                          );
                                        })}
                                        {doc.lines.length === 0 && (
                                          <div className="px-2 py-2 text-[9px] text-[#555555] italic">No invoice lines</div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Orphan lines (not assigned to any thread) */}
              {orderOrphanLines.length > 0 && (
                <div className="border border-[#FF9900]/30 bg-[#1A1A1A]">
                  <div className="px-4 py-3 flex items-center gap-2">
                    <AlertCircle className="size-4 text-[#FF9900]" />
                    <span className="text-sm font-bold text-[#FF9900]">Unassigned Lines ({orderOrphanLines.length})</span>
                    <span className="text-[9px] text-[#888888]">These lines are not linked to any order thread</span>
                  </div>
                  <div className="border-t border-[#333333] px-4 py-3">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-[8px] uppercase tracking-widest text-[#666666] border-b border-[#333333]">
                            <th className="text-left px-2 py-1.5 w-8">#</th>
                            <th className="text-left px-2 py-1.5">Description</th>
                            <th className="text-left px-2 py-1.5 w-36">Product</th>
                            <th className="text-right px-2 py-1.5 w-14">Qty</th>
                            <th className="text-left px-2 py-1.5 w-12">Unit</th>
                            <th className="text-left px-2 py-1.5 w-24">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orderOrphanLines.map((line, idx) => (
                            <tr key={line.id} className="border-b border-[#2A2A2A] hover:bg-[#1E1E1E]">
                              <td className="px-2 py-1.5 text-[#666666] bb-mono">{idx + 1}</td>
                              <td className="px-2 py-1.5">
                                <div className="text-[#E0E0E0]">{line.rawText}</div>
                                {line.notes && <div className="text-[9px] text-[#888888] mt-0.5 italic">{line.notes}</div>}
                              </td>
                              <td className="px-2 py-1.5">
                                <Badge className={`text-[7px] px-1 py-0 ${
                                  line.normalizedProduct !== "UNKNOWN" ? "text-[#00CC66] bg-[#00CC66]/10" : "text-[#FF3333] bg-[#FF3333]/10"
                                }`}>
                                  {line.normalizedProduct}
                                </Badge>
                              </td>
                              <td className="px-2 py-1.5 text-right bb-mono text-[#E0E0E0]">{Number(line.requestedQty)}</td>
                              <td className="px-2 py-1.5 text-[#888888]">{line.requestedUnit}</td>
                              <td className="px-2 py-1.5">
                                <Badge className={`text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${ORDER_LINE_STATUS_COLORS[line.status] || "text-[#888888] bg-[#333333]"}`}>
                                  {line.status}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
                </>
              )}

              {/* ============================================================ */}
              {/* SUB-VIEW: GAPS */}
              {/* ============================================================ */}
              {orderSubView === "gaps" && (
                <>
                  {/* Gaps filters */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] uppercase tracking-widest text-[#888888]">SOURCE:</span>
                      <select
                        value={gapsSourceFilter}
                        onChange={(e) => setGapsSourceFilter(e.target.value)}
                        className="h-7 bg-[#222222] border border-[#333333] text-[#E0E0E0] text-[10px] px-2"
                      >
                        <option value="ALL">All sources</option>
                        {Object.entries(orderSourceMap).map(([id, meta]) => (
                          <option key={id} value={id}>{meta.label}</option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-[#888888]">
                      <input
                        type="checkbox"
                        checked={gapsGroupByMonth}
                        onChange={(e) => setGapsGroupByMonth(e.target.checked)}
                      />
                      Group by month
                    </label>
                    <div className="text-[9px] text-[#666666] ml-auto">
                      {allUnmatchedLines.length} gaps total · estimated {fmtGBP(orderMoney.gapEstimateValue)}
                    </div>
                  </div>

                  {allUnmatchedLines.length === 0 && (
                    <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center text-[#00CC66] text-sm">
                      No gaps — every order line is matched to an invoice.
                    </div>
                  )}

                  {allUnmatchedLines.length > 0 && (() => {
                    const filtered = allUnmatchedLines.filter((l) => {
                      if (gapsSourceFilter === "ALL") return true;
                      return lineSourceId(l) === gapsSourceFilter;
                    });
                    if (filtered.length === 0) {
                      return (
                        <div className="border border-[#333333] bg-[#1A1A1A] p-6 text-center text-[#888888] text-xs">
                          No gaps match the current filter.
                        </div>
                      );
                    }

                    const groups: { key: string; lines: OrderTicketLine[] }[] = [];
                    if (gapsGroupByMonth) {
                      const byMonth: Record<string, OrderTicketLine[]> = {};
                      const order: string[] = [];
                      for (const l of filtered) {
                        const k = monthBucket(l.date);
                        if (!byMonth[k]) { byMonth[k] = []; order.push(k); }
                        byMonth[k].push(l);
                      }
                      for (const k of order) groups.push({ key: k, lines: byMonth[k] });
                    } else {
                      groups.push({ key: "All gaps", lines: filtered });
                    }

                    return (
                      <div className="space-y-4">
                        {groups.map((g) => (
                          <div key={g.key} className="border border-[#FF3333]/30 bg-[#1A1A1A]">
                            <div className="px-4 py-2 flex items-center justify-between border-b border-[#333333]">
                              <span className="text-[11px] uppercase tracking-widest text-[#FF3333] font-bold">{g.key}</span>
                              <span className="text-[9px] text-[#888888]">{g.lines.length} gap{g.lines.length !== 1 ? "s" : ""}</span>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-[8px] uppercase tracking-widest text-[#666666] border-b border-[#333333] bg-[#151515]">
                                    <th className="text-left px-2 py-1.5 w-24">Date</th>
                                    <th className="text-left px-2 py-1.5 w-28">Sender</th>
                                    <th className="text-left px-2 py-1.5 w-28">Source</th>
                                    <th className="text-left px-2 py-1.5">Order Text</th>
                                    <th className="text-left px-2 py-1.5 w-32">Product</th>
                                    <th className="text-right px-2 py-1.5 w-16">Qty</th>
                                    <th className="text-left px-2 py-1.5 w-12">Unit</th>
                                    <th className="text-left px-2 py-1.5 w-32">Thread</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.lines.map((line) => {
                                    const thread = threadByLineId[line.id];
                                    return (
                                      <tr key={line.id} className="border-b border-[#2A2A2A] hover:bg-[#1E1E1E]">
                                        <td className="px-2 py-1.5 bb-mono text-[#E0E0E0] whitespace-nowrap">
                                          {new Date(line.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                        </td>
                                        <td className="px-2 py-1.5 text-[#3399FF]">{line.sender}</td>
                                        <td className="px-2 py-1.5 text-[9px] text-[#888888]">{lineSourceLabel(line)}</td>
                                        <td className="px-2 py-1.5">
                                          <div className="text-[#E0E0E0]">{line.rawText}</div>
                                          {line.notes && <div className="text-[9px] text-[#888888] mt-0.5 italic">{line.notes}</div>}
                                        </td>
                                        <td className="px-2 py-1.5">
                                          <Badge className={`text-[7px] px-1 py-0 ${line.normalizedProduct !== "UNKNOWN" ? "text-[#00CC66] bg-[#00CC66]/10" : "text-[#FF3333] bg-[#FF3333]/10"}`}>
                                            {line.normalizedProduct}
                                          </Badge>
                                        </td>
                                        <td className="px-2 py-1.5 text-right bb-mono text-[#E0E0E0]">{Number(line.requestedQty)}</td>
                                        <td className="px-2 py-1.5 text-[#888888]">{line.requestedUnit}</td>
                                        <td className="px-2 py-1.5">
                                          {thread ? (
                                            <button
                                              onClick={() => {
                                                setOrderSubView("threads");
                                                setExpandedThreadIds((prev) => new Set([...prev, thread.id]));
                                                setTimeout(() => {
                                                  const el = document.getElementById(`thread-${thread.id}`);
                                                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                                                }, 100);
                                              }}
                                              className="text-[9px] text-[#FF6600] hover:underline text-left"
                                              title="Jump to thread"
                                            >
                                              {thread.label}
                                            </button>
                                          ) : (
                                            <span className="text-[9px] text-[#555555] italic">orphan</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}

              {/* ============================================================ */}
              {/* SUB-VIEW: REVIEW (suggested matches) */}
              {/* ============================================================ */}
              {orderSubView === "review" && (
                <>
                  {suggestedLines.length === 0 && (
                    <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center text-[#888888] text-sm">
                      No suggested matches awaiting review.
                    </div>
                  )}

                  {suggestedLines.length > 0 && (
                    <div className="space-y-3">
                      <div className="text-[9px] text-[#888888]">
                        {suggestedLines.length} order line{suggestedLines.length !== 1 ? "s" : ""} with a suggested invoice match. Approve to confirm, reject to clear.
                      </div>

                      {suggestedLines.map((line) => {
                        const suggestedInv = findSuggestedInvoiceLines(line.notes);
                        const invNum = parseSuggestedInvoiceNumber(line.notes);
                        const busy = reviewBusyId === line.id;
                        return (
                          <div key={line.id} className="border border-[#FF9900]/40 bg-[#1A1A1A] p-3 space-y-2">
                            <div className="grid grid-cols-2 gap-3">
                              {/* Order line */}
                              <div className="border border-[#333333] bg-[#151515] p-2 space-y-1">
                                <div className="text-[8px] uppercase tracking-widest text-[#888888] font-bold">ORDER LINE</div>
                                <div className="text-[10px] text-[#666666] bb-mono">
                                  {new Date(line.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · {line.sender}
                                </div>
                                <div className="text-xs text-[#E0E0E0]">{line.rawText}</div>
                                <div className="flex items-center gap-2">
                                  <Badge className="text-[7px] px-1 py-0 text-[#00CC66] bg-[#00CC66]/10">{line.normalizedProduct}</Badge>
                                  <span className="text-[10px] bb-mono text-[#E0E0E0]">{Number(line.requestedQty)} {line.requestedUnit}</span>
                                </div>
                                {line.orderThread && (
                                  <div className="text-[9px] text-[#888888]">Thread: <span className="text-[#FF6600]">{line.orderThread.label}</span></div>
                                )}
                              </div>

                              {/* Suggested invoice */}
                              <div className="border border-[#FF9900]/40 bg-[#151515] p-2 space-y-1">
                                <div className="text-[8px] uppercase tracking-widest text-[#FF9900] font-bold">
                                  SUGGESTED MATCH {invNum && <span className="text-[#E0E0E0]">· {invNum}</span>}
                                </div>
                                {suggestedInv.length === 0 ? (
                                  <div className="text-[10px] text-[#FF3333] italic">
                                    Invoice {invNum || "(unknown)"} not found in this case
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    {suggestedInv.map((il) => (
                                      <div key={il.id} className="border border-[#333333] bg-[#1A1A1A] p-2 space-y-1">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] text-[#E0E0E0] font-bold">{il.invoiceNumber}</span>
                                          <span className="text-[9px] text-[#888888] bb-mono">
                                            {new Date(il.invoiceDate).toLocaleDateString("en-GB")}
                                          </span>
                                        </div>
                                        <div className="text-xs text-[#E0E0E0]">{il.productDescription}</div>
                                        <div className="flex items-center gap-2 text-[10px]">
                                          <Badge className="text-[7px] px-1 py-0 text-[#00CC66] bg-[#00CC66]/10">{il.normalizedProduct}</Badge>
                                          <span className="bb-mono text-[#E0E0E0]">{Number(il.qty)} {il.unit}</span>
                                          {il.rate != null && <span className="bb-mono text-[#888888]">@ {fmtGBP(Number(il.rate))}</span>}
                                          {il.amount != null && <span className="bb-mono text-[#FF9900] font-bold">{fmtGBP(Number(il.amount))}</span>}
                                        </div>
                                        <Button
                                          size="sm"
                                          disabled={busy}
                                          onClick={() => approveSuggestedMatch(line.id, il.id)}
                                          className="h-6 px-2 text-[9px] bg-[#00CC66] text-black hover:bg-[#00AA55]"
                                        >
                                          {busy ? "..." : "Approve this match"}
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => rejectSuggestedMatch(line.id)}
                                className="h-7 px-2 text-[10px] bg-[#222222] border border-[#333333] text-[#FF3333] hover:bg-[#FF3333]/10"
                              >
                                Reject suggestion
                              </Button>
                              {line.notes && (
                                <span className="text-[9px] text-[#888888] italic truncate flex-1">{line.notes}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* ============================================================ */}
              {/* SUB-VIEW: IMAGES */}
              {/* ============================================================ */}
              {orderSubView === "images" && (
                <>
                  {imageMessages.length === 0 && (
                    <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center text-[#888888] text-sm">
                      No image messages found within this case date range.
                    </div>
                  )}

                  {imageMessages.length > 0 && (() => {
                    // Group by date (DD MMM YYYY)
                    const byDate: Record<string, ImageMessage[]> = {};
                    const order: string[] = [];
                    for (const im of imageMessages) {
                      const k = new Date(im.parsedTimestamp).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                      if (!byDate[k]) { byDate[k] = []; order.push(k); }
                      byDate[k].push(im);
                    }
                    return (
                      <div className="space-y-4">
                        <div className="text-[9px] text-[#888888]">
                          {imageMessages.length} image{imageMessages.length !== 1 ? "s" : ""} across {order.length} day{order.length !== 1 ? "s" : ""}. Images themselves are not stored — review context and add line items manually.
                        </div>
                        {order.map((dateKey) => (
                          <div key={dateKey} className="border border-[#AA66FF]/30 bg-[#1A1A1A]">
                            <div className="px-4 py-2 border-b border-[#333333] flex items-center gap-2">
                              <Image className="size-3.5 text-[#AA66FF]" />
                              <span className="text-[11px] uppercase tracking-widest text-[#AA66FF] font-bold">{dateKey}</span>
                              <span className="text-[9px] text-[#888888] ml-auto">{byDate[dateKey].length} image{byDate[dateKey].length !== 1 ? "s" : ""}</span>
                            </div>
                            <div className="divide-y divide-[#2A2A2A]">
                              {byDate[dateKey].map((im) => {
                                const ctx = imageContext[im.id];
                                const srcLabel = orderSourceMap[im.sourceId]?.label || "";
                                return (
                                  <div key={im.id} className="px-4 py-3 space-y-2">
                                    <div className="flex items-center gap-2 text-[10px]">
                                      <span className="bb-mono text-[#888888]">
                                        {new Date(im.parsedTimestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                                      </span>
                                      <span className="font-bold text-[#3399FF]">{im.sender}</span>
                                      <span className="text-[9px] text-[#555555]">{srcLabel}</span>
                                      <Badge className="text-[7px] px-1 py-0 text-[#AA66FF] bg-[#AA66FF]/10">IMAGE</Badge>
                                      {im.mediaType && <span className="text-[8px] text-[#666666]">{im.mediaType}</span>}
                                    </div>
                                    <div className="border border-[#AA66FF]/20 bg-[#151515] p-2">
                                      {ctx && ctx.before.length > 0 && (
                                        <div className="space-y-1 mb-2">
                                          <div className="text-[8px] uppercase tracking-widest text-[#666666]">Before</div>
                                          {ctx.before.map((m) => (
                                            <div key={m.id} className="text-[10px] text-[#888888] pl-2 border-l border-[#333333]">
                                              <span className="text-[#666666] bb-mono mr-1">
                                                {new Date(m.parsedTimestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                                              </span>
                                              <span className="text-[#3399FF] font-bold">{m.sender}:</span> {m.rawText}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      <div className="text-[10px] text-[#FF9900] italic bg-[#FF9900]/5 border border-[#FF9900]/20 px-2 py-1.5">
                                        [Image not stored — please review and add line items]
                                        {im.rawText && im.rawText !== "<Media omitted>" && (
                                          <div className="text-[#E0E0E0] not-italic mt-1">Caption: {im.rawText}</div>
                                        )}
                                        {im.mediaFilename && (
                                          <div className="text-[#888888] not-italic mt-0.5">File: {im.mediaFilename}</div>
                                        )}
                                      </div>
                                      {ctx && ctx.after.length > 0 && (
                                        <div className="space-y-1 mt-2">
                                          <div className="text-[8px] uppercase tracking-widest text-[#666666]">After</div>
                                          {ctx.after.map((m) => (
                                            <div key={m.id} className="text-[10px] text-[#888888] pl-2 border-l border-[#333333]">
                                              <span className="text-[#666666] bb-mono mr-1">
                                                {new Date(m.parsedTimestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                                              </span>
                                              <span className="text-[#3399FF] font-bold">{m.sender}:</span> {m.rawText}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}

              {/* ============================================================ */}
              {/* SUB-VIEW: UNMATCHED INVOICE LINES */}
              {/* ============================================================ */}
              {orderSubView === "unmatched-invoices" && (
                <>
                  <div className="text-[9px] text-[#888888]">
                    {unmatchedInvoiceLines.length} invoice line{unmatchedInvoiceLines.length !== 1 ? "s" : ""} with no order match · Total {fmtGBP(orderMoney.unmatchedInvoiceValue)}
                  </div>

                  {unmatchedInvoiceLines.length === 0 && (
                    <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center text-[#00CC66] text-sm">
                      All invoice lines are matched to orders.
                    </div>
                  )}

                  {unmatchedInvoiceLines.length > 0 && (
                    <div className="border border-[#FF9900]/30 bg-[#1A1A1A]">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[8px] uppercase tracking-widest text-[#666666] border-b border-[#333333] bg-[#151515]">
                              <th className="text-left px-2 py-1.5 w-24">Invoice #</th>
                              <th className="text-left px-2 py-1.5 w-24">Date</th>
                              <th className="text-left px-2 py-1.5">Description</th>
                              <th className="text-left px-2 py-1.5 w-32">Product</th>
                              <th className="text-right px-2 py-1.5 w-16">Qty</th>
                              <th className="text-left px-2 py-1.5 w-12">Unit</th>
                              <th className="text-right px-2 py-1.5 w-20">Rate</th>
                              <th className="text-right px-2 py-1.5 w-24">Amount</th>
                              <th className="text-left px-2 py-1.5 w-32">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {unmatchedInvoiceLines.map((il) => {
                              const active = manualLinkInvoiceId === il.id;
                              const busy = reviewBusyId === il.id;
                              const q = manualLinkQuery.trim().toLowerCase();
                              const candidates = active
                                ? allUnmatchedLines.filter((t) => {
                                    if (!q) return true;
                                    return (
                                      t.rawText.toLowerCase().includes(q) ||
                                      t.normalizedProduct.toLowerCase().includes(q) ||
                                      t.sender.toLowerCase().includes(q)
                                    );
                                  }).slice(0, 20)
                                : [];
                              return (
                                <React.Fragment key={il.id}>
                                  <tr className="border-b border-[#2A2A2A] hover:bg-[#1E1E1E]">
                                    <td className="px-2 py-1.5 bb-mono text-[#E0E0E0] font-bold">{il.invoiceNumber}</td>
                                    <td className="px-2 py-1.5 bb-mono text-[#E0E0E0] whitespace-nowrap">
                                      {new Date(il.invoiceDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                    </td>
                                    <td className="px-2 py-1.5 text-[#E0E0E0]">{il.productDescription}</td>
                                    <td className="px-2 py-1.5">
                                      <Badge className="text-[7px] px-1 py-0 text-[#00CC66] bg-[#00CC66]/10">{il.normalizedProduct}</Badge>
                                    </td>
                                    <td className="px-2 py-1.5 text-right bb-mono text-[#E0E0E0]">{Number(il.qty)}</td>
                                    <td className="px-2 py-1.5 text-[#888888]">{il.unit}</td>
                                    <td className="px-2 py-1.5 text-right bb-mono text-[#888888]">
                                      {il.rate != null ? fmtGBP(Number(il.rate)) : "--"}
                                    </td>
                                    <td className="px-2 py-1.5 text-right bb-mono text-[#FF9900] font-bold">
                                      {il.amount != null ? fmtGBP(Number(il.amount)) : "--"}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <button
                                        onClick={() => {
                                          if (active) { setManualLinkInvoiceId(null); setManualLinkQuery(""); }
                                          else { setManualLinkInvoiceId(il.id); setManualLinkQuery(""); }
                                        }}
                                        className={`text-[9px] px-2 py-0.5 border ${
                                          active
                                            ? "bg-[#FF6600] text-black border-[#FF6600]"
                                            : "bg-[#222222] text-[#E0E0E0] border-[#333333] hover:border-[#FF6600]"
                                        }`}
                                      >
                                        {active ? "Cancel" : "Link to order"}
                                      </button>
                                    </td>
                                  </tr>
                                  {active && (
                                    <tr className="bg-[#151515]">
                                      <td colSpan={9} className="px-3 py-3">{/* manual link panel */}
                                        <div className="space-y-2">
                                          <div className="flex items-center gap-2">
                                            <span className="text-[9px] uppercase tracking-widest text-[#888888]">Find order line:</span>
                                            <Input
                                              value={manualLinkQuery}
                                              onChange={(e) => setManualLinkQuery(e.target.value)}
                                              placeholder="Search by product, text, or sender..."
                                              className="h-7 text-[10px] bg-[#222222] border-[#333333]"
                                            />
                                          </div>
                                          <div className="max-h-60 overflow-y-auto border border-[#333333] bg-[#1A1A1A]">
                                            {candidates.length === 0 ? (
                                              <div className="p-2 text-[9px] text-[#666666] italic">No unmatched order lines match.</div>
                                            ) : (
                                              candidates.map((t) => (
                                                <button
                                                  key={t.id}
                                                  disabled={busy}
                                                  onClick={() => linkInvoiceToTicketLine(il.id, t.id)}
                                                  className="w-full text-left px-2 py-1.5 border-b border-[#2A2A2A] last:border-b-0 hover:bg-[#222222] disabled:opacity-50"
                                                >
                                                  <div className="flex items-center gap-2 text-[10px]">
                                                    <span className="bb-mono text-[#666666] whitespace-nowrap">
                                                      {new Date(t.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                                                    </span>
                                                    <span className="text-[#3399FF] font-bold">{t.sender}</span>
                                                    <Badge className="text-[7px] px-1 py-0 text-[#00CC66] bg-[#00CC66]/10">{t.normalizedProduct}</Badge>
                                                    <span className="bb-mono text-[#E0E0E0]">{Number(t.requestedQty)} {t.requestedUnit}</span>
                                                    <span className="text-[9px] text-[#888888] truncate flex-1">{t.rawText}</span>
                                                  </div>
                                                </button>
                                              ))
                                            )}
                                          </div>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {!ordersLoading && !ordersLoaded && (
            <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center space-y-3">
              <ShoppingCart className="size-8 text-[#FF6600] mx-auto" />
              <div className="text-sm text-[#E0E0E0]">Order Threads</div>
              <div className="text-[9px] text-[#666666]">Click to load reconstructed order threads with line items and invoice reconciliation.</div>
              <Button onClick={() => loadOrderThreads()} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">Load Orders</Button>
            </div>
          )}
        </TabsContent>

        {/* INVOICES TAB */}
        <TabsContent value="invoices" className="mt-4 space-y-4">
          {/* Upload zone */}
          <div className="border border-[#333333] bg-[#1A1A1A] p-4 space-y-3">
            <div className="text-[10px] uppercase tracking-widest text-[#888888] font-bold flex items-center gap-2">
              <Upload className="size-3.5" /> UPLOAD PDF INVOICES
            </div>

            <div className="flex items-center gap-3">
              <div className="space-y-1 flex-1">
                <label className="text-[9px] text-[#666666]">Upload to source:</label>
                <select
                  value={invoiceUploadSourceId}
                  onChange={(e) => setInvoiceUploadSourceId(e.target.value)}
                  className="w-full h-8 bg-[#222222] border border-[#333333] text-[#E0E0E0] text-xs px-2"
                >
                  <option value="">Select document source...</option>
                  {documentSources.length > 0
                    ? documentSources.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.sourceType})</option>)
                    : allSources.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.sourceType})</option>)
                  }
                </select>
              </div>
            </div>

            {invoiceUploadSourceId && (
              <div
                onDragOver={(e) => { e.preventDefault(); setInvoiceDragOver(true); }}
                onDragLeave={() => setInvoiceDragOver(false)}
                onDrop={handleInvoiceDrop}
                className={`border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                  invoiceDragOver
                    ? "border-[#FF6600] bg-[#FF6600]/5"
                    : "border-[#333333] hover:border-[#FF6600]/50"
                }`}
                onClick={() => invoiceFileRef.current?.click()}
              >
                <input
                  ref={invoiceFileRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  onChange={handleInvoiceFileSelect}
                  style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                />
                {invoiceUploading ? (
                  <div className="flex items-center justify-center gap-2 text-[#FF6600]">
                    <Loader2 className="size-5 animate-spin" />
                    <span className="text-sm">Uploading & parsing...</span>
                  </div>
                ) : (
                  <>
                    <FileText className="size-8 text-[#FF6600] mx-auto mb-2" />
                    <div className="text-sm text-[#E0E0E0]">Drop PDF invoices here</div>
                    <div className="text-[9px] text-[#666666] mt-1">or click to select files. Supports multiple PDFs.</div>
                  </>
                )}
              </div>
            )}

            {!invoiceUploadSourceId && (
              <div className="text-xs text-[#666666] italic">Select a source above to upload PDF invoices. Create a source with type PDF or DOCUMENT if none exists.</div>
            )}
          </div>

          {/* Loading indicator */}
          {invoiceLoading && (
            <div className="flex items-center justify-center gap-2 text-[#888888] py-8">
              <Loader2 className="size-4 animate-spin" /> Loading invoice documents...
            </div>
          )}

          {/* Invoice documents list */}
          {!invoiceLoading && invoiceDocs.length === 0 && (
            <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center text-[#888888] text-sm">
              No invoice documents uploaded yet. Upload PDF files above.
            </div>
          )}

          {/* Run reconciliation matching */}
          {!invoiceLoading && invoiceDocs.some((d) => d.parseStatus === "PARSED") && (
            <div className="border border-[#333333] bg-[#1A1A1A] p-4 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[#888888]">RECONCILIATION</div>
                <div className="text-xs text-[#E0E0E0] mt-1">
                  Match parsed invoice lines against WhatsApp order lines.
                </div>
                {matchResult && (
                  <div className="text-[9px] text-[#00CC66] bb-mono mt-1">
                    {matchResult.matched} matches created from {matchResult.ticketLines} order lines × {matchResult.invoiceLines} invoice lines
                  </div>
                )}
              </div>
              <Button
                onClick={runReconciliationMatch}
                disabled={runningMatch}
                className="bg-[#FF6600] text-black hover:bg-[#FF9900]"
              >
                {runningMatch ? <><Loader2 className="size-4 mr-1 animate-spin" />Matching...</> : "Run Matching"}
              </Button>
            </div>
          )}

          {!invoiceLoading && invoiceDocs.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-[#888888]">
                  {invoiceDocs.length} DOCUMENT{invoiceDocs.length !== 1 ? "S" : ""} UPLOADED
                </div>
                <button onClick={deleteAllInvoiceDocs} className="text-[9px] text-[#FF3333] hover:text-[#FF6666] flex items-center gap-1">
                  <Trash2 className="size-3" /> Delete All
                </button>
              </div>

              {invoiceDocs.map((doc) => {
                const isExpanded = expandedInvoiceId === doc.id;
                return (
                  <div key={doc.id} className="border border-[#333333] bg-[#1A1A1A]">
                    {/* Document header */}
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[#222222]"
                      onClick={() => setExpandedInvoiceId(isExpanded ? null : doc.id)}
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown className="size-4 text-[#888888]" /> : <ChevronRight className="size-4 text-[#888888]" />}
                        <FileText className="size-5 text-[#FF6600]" />
                        <div>
                          <div className="text-sm text-[#E0E0E0] font-medium">
                            {doc.invoiceNumber || doc.rawFileName}
                          </div>
                          <div className="text-[9px] text-[#666666] bb-mono mt-0.5 flex items-center gap-3">
                            <span>{doc.rawFileName}</span>
                            <span>{(doc.fileBytes / 1024).toFixed(1)} KB</span>
                            <span>{doc.pageCount} page{doc.pageCount !== 1 ? "s" : ""}</span>
                            {doc.invoiceDate && <span>{new Date(doc.invoiceDate).toLocaleDateString("en-GB")}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {doc.lineCount > 0 && (
                          <span className="text-[9px] text-[#888888] bb-mono">{doc.lineCount} lines</span>
                        )}
                        {doc.totalAmount != null && (
                          <span className="text-xs text-[#E0E0E0] bb-mono font-bold">
                            £{Number(doc.totalAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                          </span>
                        )}
                        {doc.parseStatus === "PARSED" && <CheckCircle2 className="size-4 text-[#00CC66]" />}
                        {doc.parseStatus === "ERROR" && <AlertCircle className="size-4 text-[#FF3333]" />}
                        {doc.parseStatus === "UPLOADED" && <Clock className="size-4 text-[#FF9900]" />}
                        {doc.parseStatus === "PARSING" && <Loader2 className="size-4 text-[#FF6600] animate-spin" />}
                        <Badge className={`text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${
                          doc.parseStatus === "PARSED" ? "text-[#00CC66] bg-[#00CC66]/10" :
                          doc.parseStatus === "ERROR" ? "text-[#FF3333] bg-[#FF3333]/10" :
                          "text-[#FF9900] bg-[#FF9900]/10"
                        }`}>
                          {doc.parseStatus}
                        </Badge>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteInvoiceDoc(doc.id, doc.sourceId || ""); }}
                          className="p-1 hover:bg-[#FF3333]/10"
                          title="Delete invoice"
                        >
                          <Trash2 className="size-3.5 text-[#FF3333]" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t border-[#333333] px-4 py-3 space-y-3 bg-[#151515]">
                        {/* Invoice metadata */}
                        <div className="grid grid-cols-4 gap-4 text-xs">
                          <div>
                            <span className="text-[9px] text-[#888888] uppercase tracking-widest">Invoice #</span>
                            <div className="text-[#E0E0E0] font-bold mt-0.5">{doc.invoiceNumber || "—"}</div>
                          </div>
                          <div>
                            <span className="text-[9px] text-[#888888] uppercase tracking-widest">Date</span>
                            <div className="text-[#E0E0E0] mt-0.5">{doc.invoiceDate ? new Date(doc.invoiceDate).toLocaleDateString("en-GB") : "—"}</div>
                          </div>
                          <div>
                            <span className="text-[9px] text-[#888888] uppercase tracking-widest">Customer</span>
                            <div className="text-[#E0E0E0] mt-0.5">{doc.customerName || "—"}</div>
                          </div>
                          <div>
                            <span className="text-[9px] text-[#888888] uppercase tracking-widest">Site</span>
                            <div className="text-[#E0E0E0] mt-0.5">{doc.site || "—"}</div>
                          </div>
                        </div>

                        {/* Error message */}
                        {doc.parseError && (
                          <div className="border border-[#FF3333]/30 bg-[#FF3333]/5 px-3 py-2 text-xs text-[#FF3333]">
                            <AlertCircle className="size-3.5 inline mr-1" />
                            {doc.parseError}
                          </div>
                        )}

                        {/* Line items table */}
                        {doc.lines.length > 0 && (
                          <div>
                            <div className="text-[9px] text-[#888888] uppercase tracking-widest mb-2">LINE ITEMS ({doc.lines.length})</div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-[8px] uppercase tracking-widest text-[#666666] border-b border-[#333333]">
                                  <th className="text-left px-2 py-1.5">Description</th>
                                  <th className="text-left px-2 py-1.5 w-28">Normalized</th>
                                  <th className="text-right px-2 py-1.5 w-14">Qty</th>
                                  <th className="text-left px-2 py-1.5 w-10">Unit</th>
                                  <th className="text-right px-2 py-1.5 w-16">Rate</th>
                                  <th className="text-right px-2 py-1.5 w-20">Amount</th>
                                  <th className="text-left px-2 py-1.5 w-14">Conf</th>
                                </tr>
                              </thead>
                              <tbody>
                                {doc.lines.map((line) => (
                                  <tr key={line.id} className="border-b border-[#2A2A2A] hover:bg-[#1A1A1A]">
                                    <td className="px-2 py-1.5 text-[#E0E0E0]">{line.productDescription}</td>
                                    <td className="px-2 py-1.5">
                                      <Badge className={`text-[7px] px-1 py-0 ${
                                        line.normalizedProduct !== "UNKNOWN" ? "text-[#00CC66] bg-[#00CC66]/10" : "text-[#FF3333] bg-[#FF3333]/10"
                                      }`}>
                                        {line.normalizedProduct}
                                      </Badge>
                                    </td>
                                    <td className="px-2 py-1.5 text-right bb-mono text-[#E0E0E0]">{Number(line.qty)}</td>
                                    <td className="px-2 py-1.5 text-[#888888]">{line.unit}</td>
                                    <td className="px-2 py-1.5 text-right bb-mono text-[#E0E0E0]">
                                      {line.rate != null ? `£${Number(line.rate).toFixed(2)}` : "—"}
                                    </td>
                                    <td className="px-2 py-1.5 text-right bb-mono text-[#E0E0E0] font-bold">
                                      {line.amount != null ? `£${Number(line.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : "—"}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <span className={`text-[9px] bb-mono ${
                                        line.billingConfidence === "HIGH" ? "text-[#00CC66]" :
                                        line.billingConfidence === "MEDIUM" ? "text-[#FF9900]" :
                                        "text-[#FF3333]"
                                      }`}>
                                        {line.billingConfidence}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              {doc.totalAmount != null && (
                                <tfoot>
                                  <tr className="border-t border-[#FF6600]/30">
                                    <td colSpan={5} className="px-2 py-2 text-right text-[9px] uppercase tracking-widest text-[#888888]">TOTAL</td>
                                    <td className="px-2 py-2 text-right bb-mono text-[#FF6600] font-bold">
                                      £{Number(doc.totalAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                                    </td>
                                    <td></td>
                                  </tr>
                                </tfoot>
                              )}
                            </table>
                          </div>
                        )}

                        {doc.lines.length === 0 && doc.parseStatus === "PARSED" && (
                          <div className="text-xs text-[#FF9900]">No line items could be extracted from this invoice.</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* RECONCILIATION TAB */}
        <TabsContent value="reconciliation" className="mt-4">
          <ReconciliationPanel caseId={backlogCase.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
