"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ChevronDown, ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type SitePackItem = {
  id: string;
  status: string;
  ticket: { id: string; title: string } | null;
  salesInvoice: { id: string; invoiceNo: string } | null;
  evidencePack: { id: string; status: string } | null;
};

type SitePack = {
  id: string;
  packDate: string;
  status: string;
  summaryNotes: string | null;
  site: { id: string; siteName: string };
  items: SitePackItem[];
};

type Site = {
  id: string;
  siteName: string;
};

function statusBadge(status: string) {
  switch (status) {
    case "DRAFT":
      return <Badge className="bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300">{status}</Badge>;
    case "FINALIZED":
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">{status}</Badge>;
    case "SENT":
      return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">{status}</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function itemStatusBadge(status: string) {
  switch (status) {
    case "INCLUDED":
      return <Badge variant="outline" className="text-green-700 border-green-300 dark:text-green-400 dark:border-green-700">{status}</Badge>;
    case "EXCLUDED":
      return <Badge variant="outline" className="text-red-700 border-red-300 dark:text-red-400 dark:border-red-700">{status}</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function SitePacksView({
  sitePacks,
  sites,
}: {
  sitePacks: SitePack[];
  sites: Site[];
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Create form
  const [siteId, setSiteId] = useState("");
  const [summaryNotes, setSummaryNotes] = useState("");

  // Add item dialog
  const [addItemPackId, setAddItemPackId] = useState<string | null>(null);
  const [itemTicketId, setItemTicketId] = useState("");
  const [itemInvoiceId, setItemInvoiceId] = useState("");
  const [itemEvidencePackId, setItemEvidencePackId] = useState("");

  async function handleCreatePack() {
    if (!siteId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/site-packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          summaryNotes: summaryNotes || null,
        }),
      });
      if (res.ok) {
        setSheetOpen(false);
        setSiteId("");
        setSummaryNotes("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFinalize(packId: string) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/site-packs/${packId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "FINALIZED" }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddItem(packId: string) {
    if (!itemTicketId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/site-packs/${packId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: itemTicketId,
          salesInvoiceId: itemInvoiceId || null,
          evidencePackId: itemEvidencePackId || null,
        }),
      });
      if (res.ok) {
        setAddItemPackId(null);
        setItemTicketId("");
        setItemInvoiceId("");
        setItemEvidencePackId("");
        router.refresh();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to add item");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex justify-end">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            render={
              <Button>
                <Plus className="size-4 mr-1" />
                Create Site Pack
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Create Site Pack</SheetTitle>
              <SheetDescription>Create a new site pack for document bundling.</SheetDescription>
            </SheetHeader>
            <div className="p-4 space-y-4">
              <div className="space-y-2">
                <Label>Site</Label>
                <Select value={siteId} onValueChange={(v) => setSiteId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select site" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.siteName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Summary Notes</Label>
                <Textarea
                  value={summaryNotes}
                  onChange={(e) => setSummaryNotes(e.target.value)}
                  placeholder="Optional notes..."
                  rows={3}
                />
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3">
                <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
                  <Lock className="size-4 shrink-0" />
                  <span>Only LOCKED or VERIFIED tickets can be included in site packs.</span>
                </div>
              </div>
              <Button
                className="w-full"
                onClick={handleCreatePack}
                disabled={submitting || !siteId}
              >
                {submitting ? "Creating..." : "Create Site Pack"}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Site</TableHead>
              <TableHead>Pack Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead>Summary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sitePacks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No site packs created yet.
                </TableCell>
              </TableRow>
            ) : (
              sitePacks.map((sp) => {
                const isExpanded = expandedId === sp.id;
                return (
                  <Fragment key={sp.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedId(isExpanded ? null : sp.id)}
                    >
                      <TableCell>
                        {isExpanded ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{sp.site.siteName}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {new Date(sp.packDate).toLocaleDateString("en-GB")}
                      </TableCell>
                      <TableCell>{statusBadge(sp.status)}</TableCell>
                      <TableCell className="text-right tabular-nums">{sp.items.length}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground">
                        {sp.summaryNotes || "\u2014"}
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/30 p-4">
                          <div className="space-y-4">
                            {/* Items sub-table */}
                            {sp.items.length > 0 ? (
                              <div className="rounded-md border bg-background">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Ticket</TableHead>
                                      <TableHead>Invoice No</TableHead>
                                      <TableHead>Evidence Pack</TableHead>
                                      <TableHead>Status</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {sp.items.map((item) => (
                                      <TableRow key={item.id}>
                                        <TableCell className="font-medium">
                                          {item.ticket?.title || "\u2014"}
                                        </TableCell>
                                        <TableCell>
                                          {item.salesInvoice?.invoiceNo || "\u2014"}
                                        </TableCell>
                                        <TableCell>
                                          {item.evidencePack ? (
                                            <Badge variant="outline">{item.evidencePack.status}</Badge>
                                          ) : (
                                            "\u2014"
                                          )}
                                        </TableCell>
                                        <TableCell>{itemStatusBadge(item.status)}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">No items in this pack.</p>
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-2">
                              {sp.status === "DRAFT" && (
                                <>
                                  <Button
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleFinalize(sp.id);
                                    }}
                                    disabled={submitting}
                                  >
                                    Finalize
                                  </Button>

                                  <Dialog
                                    open={addItemPackId === sp.id}
                                    onOpenChange={(open) => {
                                      if (!open) {
                                        setAddItemPackId(null);
                                        setItemTicketId("");
                                        setItemInvoiceId("");
                                        setItemEvidencePackId("");
                                      }
                                    }}
                                  >
                                    <DialogTrigger
                                      render={
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setAddItemPackId(sp.id);
                                          }}
                                        >
                                          <Plus className="size-4 mr-1" />
                                          Add Ticket
                                        </Button>
                                      }
                                    />
                                    <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
                                      <DialogHeader>
                                        <DialogTitle>Add Ticket to Pack</DialogTitle>
                                        <DialogDescription>
                                          Only LOCKED or VERIFIED tickets can be added.
                                        </DialogDescription>
                                      </DialogHeader>
                                      <div className="space-y-4 py-2">
                                        <div className="space-y-2">
                                          <Label>Ticket ID</Label>
                                          <Input
                                            value={itemTicketId}
                                            onChange={(e) => setItemTicketId(e.target.value)}
                                            placeholder="Ticket ID"
                                          />
                                        </div>
                                        <div className="space-y-2">
                                          <Label>Sales Invoice ID (optional)</Label>
                                          <Input
                                            value={itemInvoiceId}
                                            onChange={(e) => setItemInvoiceId(e.target.value)}
                                            placeholder="Invoice ID"
                                          />
                                        </div>
                                        <div className="space-y-2">
                                          <Label>Evidence Pack ID (optional)</Label>
                                          <Input
                                            value={itemEvidencePackId}
                                            onChange={(e) => setItemEvidencePackId(e.target.value)}
                                            placeholder="Evidence Pack ID"
                                          />
                                        </div>
                                      </div>
                                      <DialogFooter>
                                        <Button
                                          onClick={() => handleAddItem(sp.id)}
                                          disabled={submitting || !itemTicketId}
                                        >
                                          {submitting ? "Adding..." : "Add to Pack"}
                                        </Button>
                                      </DialogFooter>
                                    </DialogContent>
                                  </Dialog>
                                </>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
