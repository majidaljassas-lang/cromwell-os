"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Star,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const EVIDENCE_TYPES = [
  "INSTRUCTION",
  "APPROVAL",
  "PRICING",
  "DELIVERY",
  "DISPUTE",
  "PO_REQUEST",
  "PO_RECEIVED",
  "SUPPLIER_CONFIRMATION",
  "PHOTO",
  "CALL_NOTE",
] as const;

const SOURCE_TYPES = [
  "WHATSAPP",
  "OUTLOOK",
  "ZOHO_BOOKS",
  "EMAIL",
  "PDF_UPLOAD",
  "IMAGE_UPLOAD",
  "MANUAL",
  "API",
] as const;

const CHECKLIST_TYPES = [
  "INSTRUCTION",
  "APPROVAL",
  "PRICING",
  "DELIVERY",
  "SUPPLIER_CONFIRMATION",
  "PO_RECEIVED",
] as const;

type Decimal = { toString(): string } | string | number | null;

type EvidenceFragmentData = {
  id: string;
  sourceType: string;
  sourceRef: string | null;
  sourceContactId: string | null;
  fragmentType: string;
  fragmentText: string | null;
  attachmentUrl: string | null;
  timestamp: string | Date;
  isPrimaryEvidence: boolean;
  ticketLineId: string | null;
  ticketLine: { id: string; description: string } | null;
  sourceContact: { id: string; fullName: string } | null;
};

type EvidencePackItemData = {
  id: string;
  evidenceFragmentId: string | null;
  eventId: string | null;
  documentRef: string | null;
  summaryText: string | null;
  sortOrder: number;
  evidenceFragment: {
    id: string;
    fragmentType: string;
    fragmentText: string | null;
  } | null;
  event: {
    id: string;
    eventType: string;
    notes: string | null;
  } | null;
};

type EvidencePackData = {
  id: string;
  packType: string;
  status: string;
  generatedAt: string | null;
  finalizedAt: string | null;
  createdAt: string;
  items: EvidencePackItemData[];
};

type TicketLineOption = {
  id: string;
  description: string;
};

function evidenceTypeBadgeColor(type: string): string {
  switch (type) {
    case "INSTRUCTION": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "APPROVAL": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "PRICING": return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
    case "DELIVERY": return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
    case "SUPPLIER_CONFIRMATION": return "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300";
    case "PO_RECEIVED": return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300";
    case "DISPUTE": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    case "PO_REQUEST": return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    case "PHOTO": return "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300";
    case "CALL_NOTE": return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300";
    default: return "bg-gray-100 text-gray-800";
  }
}

export function EvidencePanel({
  ticketId,
  evidenceFragments,
  evidencePacks,
  ticketLines = [],
}: {
  ticketId: string;
  evidenceFragments: EvidenceFragmentData[];
  evidencePacks: EvidencePackData[];
  ticketLines?: TicketLineOption[];
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expandedPackId, setExpandedPackId] = useState<string | null>(null);

  // Add evidence form state
  const [fragmentType, setFragmentType] = useState<string>("INSTRUCTION");
  const [sourceType, setSourceType] = useState<string>("MANUAL");
  const [sourceRef, setSourceRef] = useState("");
  const [fragmentText, setFragmentText] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [ticketLineId, setTicketLineId] = useState("");

  // Checklist: which evidence types are present
  const presentTypes = new Set(evidenceFragments.map((ef) => ef.fragmentType));

  async function handleAddEvidence(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        fragmentType,
        sourceType,
        sourceRef: sourceRef || undefined,
        fragmentText: fragmentText || undefined,
        attachmentUrl: attachmentUrl || undefined,
        isPrimaryEvidence: isPrimary,
        ticketLineId: ticketLineId || undefined,
      };
      const res = await fetch(`/api/tickets/${ticketId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setAddOpen(false);
        resetForm();
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setFragmentType("INSTRUCTION");
    setSourceType("MANUAL");
    setSourceRef("");
    setFragmentText("");
    setAttachmentUrl("");
    setIsPrimary(false);
    setTicketLineId("");
  }

  async function handleFinalizePack(packId: string) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/evidence-packs/${packId}/finalize`, {
        method: "POST",
      });
      if (res.ok) router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Evidence Checklist */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Evidence Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2">
            {CHECKLIST_TYPES.map((type) => {
              const present = presentTypes.has(type);
              return (
                <div key={type} className="flex items-center gap-2 text-sm">
                  {present ? (
                    <Check className="size-4 text-green-600" />
                  ) : (
                    <X className="size-4 text-red-400" />
                  )}
                  <span className={present ? "text-foreground" : "text-muted-foreground"}>
                    {type.replace(/_/g, " ")}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Evidence Fragments */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium">Evidence Fragments ({evidenceFragments.length})</h3>
          <Sheet open={addOpen} onOpenChange={setAddOpen}>
            <SheetTrigger
              render={
                <Button size="sm">
                  <Plus className="size-4 mr-1" />
                  Add Evidence
                </Button>
              }
            />
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Add Evidence Fragment</SheetTitle>
                <SheetDescription>
                  Record a new piece of evidence for this ticket.
                </SheetDescription>
              </SheetHeader>
              <form
                onSubmit={handleAddEvidence}
                className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
              >
                <div className="space-y-1.5">
                  <Label>Fragment Type</Label>
                  <Select value={fragmentType} onValueChange={(v) => setFragmentType(v ?? "INSTRUCTION")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVIDENCE_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Source Type</Label>
                  <Select value={sourceType} onValueChange={(v) => setSourceType(v ?? "MANUAL")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCE_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="source-ref">Source Reference</Label>
                  <Input
                    id="source-ref"
                    value={sourceRef}
                    onChange={(e) => setSourceRef(e.target.value)}
                    placeholder="e.g. WhatsApp msg ID, email subject"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fragment-text">Evidence Text</Label>
                  <Textarea
                    id="fragment-text"
                    value={fragmentText}
                    onChange={(e) => setFragmentText(e.target.value)}
                    placeholder="Describe the evidence..."
                    rows={4}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="attachment-url">Attachment URL</Label>
                  <Input
                    id="attachment-url"
                    value={attachmentUrl}
                    onChange={(e) => setAttachmentUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
                {ticketLines.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>Ticket Line (optional)</Label>
                    <Select value={ticketLineId} onValueChange={(v) => setTicketLineId(v ?? "")}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="No line linked" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {ticketLines.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.description}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is-primary"
                    checked={isPrimary}
                    onChange={(e) => setIsPrimary(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <Label htmlFor="is-primary">Primary Evidence</Label>
                </div>
                <SheetFooter>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Adding..." : "Add Evidence"}
                  </Button>
                </SheetFooter>
              </form>
            </SheetContent>
          </Sheet>
        </div>

        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Text</TableHead>
                <TableHead>Primary</TableHead>
                <TableHead>Ticket Line</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evidenceFragments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No evidence fragments recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                evidenceFragments.map((ef) => (
                  <TableRow key={ef.id}>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${evidenceTypeBadgeColor(ef.fragmentType)}`}>
                        {ef.fragmentType.replace(/_/g, " ")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ef.sourceType.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {ef.sourceContact?.fullName || "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(ef.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                      {ef.fragmentText || "\u2014"}
                    </TableCell>
                    <TableCell>
                      {ef.isPrimaryEvidence && (
                        <Star className="size-4 text-yellow-500 fill-yellow-500" />
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[120px] truncate">
                      {ef.ticketLine?.description || "\u2014"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Evidence Packs */}
      <div>
        <h3 className="text-lg font-medium mb-3">Evidence Packs ({evidencePacks.length})</h3>
        {evidencePacks.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No evidence packs compiled yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {evidencePacks.map((pack) => {
              const isExpanded = expandedPackId === pack.id;
              return (
                <Card key={pack.id}>
                  <CardContent className="py-3">
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => setExpandedPackId(isExpanded ? null : pack.id)}
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                        <Badge variant="outline">{pack.packType.replace(/_/g, " ")}</Badge>
                        <Badge variant={pack.status === "FINALIZED" ? "default" : "secondary"}>
                          {pack.status}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {pack.items.length} items
                        </span>
                        {pack.generatedAt && (
                          <span className="text-xs text-muted-foreground">
                            Generated: {new Date(pack.generatedAt).toLocaleDateString()}
                          </span>
                        )}
                        {pack.finalizedAt && (
                          <span className="text-xs text-muted-foreground">
                            Finalized: {new Date(pack.finalizedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div>
                        {pack.status !== "FINALIZED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleFinalizePack(pack.id);
                            }}
                            disabled={submitting}
                          >
                            <Lock className="size-4 mr-1" />
                            Finalize
                          </Button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 border-t pt-3">
                        <div className="rounded border bg-background">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Content</TableHead>
                                <TableHead>Document Ref</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {pack.items.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">
                                    No items in this pack.
                                  </TableCell>
                                </TableRow>
                              ) : (
                                pack.items.map((item) => (
                                  <TableRow key={item.id}>
                                    <TableCell className="tabular-nums">{item.sortOrder}</TableCell>
                                    <TableCell>
                                      {item.evidenceFragment ? (
                                        <Badge variant="secondary">
                                          {item.evidenceFragment.fragmentType.replace(/_/g, " ")}
                                        </Badge>
                                      ) : item.event ? (
                                        <Badge variant="outline">
                                          {item.event.eventType.replace(/_/g, " ")}
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline">Document</Badge>
                                      )}
                                    </TableCell>
                                    <TableCell className="max-w-[300px] truncate text-sm text-muted-foreground">
                                      {item.summaryText ||
                                        item.evidenceFragment?.fragmentText ||
                                        item.event?.notes ||
                                        "\u2014"}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                      {item.documentRef || "\u2014"}
                                    </TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
