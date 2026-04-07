"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ArrowRightCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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

const ENQUIRY_TYPES = [
  "DIRECT_ORDER",
  "QUOTE_REQUEST",
  "PRICING_FIRST",
  "SPEC_REQUEST",
  "COMPETITIVE_BID",
  "APPROVAL",
  "FOLLOW_UP",
  "DELIVERY_UPDATE",
  "DISPUTE",
  "OTHER",
] as const;

const TICKET_MODES = [
  "DIRECT_ORDER",
  "PRICING_FIRST",
  "SPEC_DRIVEN",
  "COMPETITIVE_BID",
  "RECOVERY",
  "CASH_SALE",
  "LABOUR_ONLY",
  "PROJECT_WORK",
  "NON_SITE",
] as const;

type EnquiryRow = {
  id: string;
  sourceType: string;
  subjectOrLabel: string | null;
  rawText: string;
  enquiryType: string;
  status: string;
  receivedAt: Date;
  createdAt: Date;
  sourceContact: { id: string; fullName: string } | null;
  suggestedSite: { id: string; siteName: string } | null;
  suggestedCustomer: { id: string; name: string } | null;
  workItems: { id: string }[];
};

function statusColor(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "OPEN":
      return "default";
    case "CONVERTED":
      return "secondary";
    case "CLOSED_LOST":
    case "CLOSED_NO_ACTION":
      return "outline";
    case "PRICING":
    case "QUOTE_SENT":
      return "secondary";
    default:
      return "outline";
  }
}

export function EnquiriesTable({
  enquiries,
  customers = [],
}: {
  enquiries: EnquiryRow[];
  customers?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertingEnquiryId, setConvertingEnquiryId] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<string>("DIRECT_ORDER");
  const [converting, setConverting] = useState(false);

  // Form state for selects
  const [sourceType, setSourceType] = useState<string>("MANUAL");
  const [enquiryType, setEnquiryType] = useState<string>("DIRECT_ORDER");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);

    const form = e.currentTarget;
    const formData = new FormData(form);

    const body = {
      sourceType,
      rawText: formData.get("rawText") as string,
      subjectOrLabel: (formData.get("subjectOrLabel") as string) || undefined,
      enquiryType,
      receivedAt: (formData.get("receivedAt") as string) || new Date().toISOString(),
      status: "OPEN",
    };

    try {
      const res = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // If file attached and enquiry created, upload it as evidence
      const file = (form.querySelector('input[name="attachment"]') as HTMLInputElement)?.files?.[0];
      if (res.ok && file) {
        const data = await res.json();
        const uploadData = new FormData();
        uploadData.append("file", file);
        uploadData.append("enquiryId", data.id);
        uploadData.append("sourceType", sourceType);
        await fetch("/api/enquiries/upload-attachment", { method: "POST", body: uploadData });
      }

      if (res.ok) {
        form.reset();
        setOpen(false);
        setSourceType("MANUAL");
        setEnquiryType("DIRECT_ORDER");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const [convertError, setConvertError] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");

  async function handleConvert() {
    if (!convertingEnquiryId) return;
    if (!selectedCustomerId) {
      setConvertError("Select a customer before converting");
      return;
    }
    setConverting(true);
    setConvertError(null);

    try {
      const res = await fetch(
        `/api/enquiries/${convertingEnquiryId}/convert-to-work-item`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: selectedMode,
            customerId: selectedCustomerId,
            createTicket: true,
          }),
        }
      );

      const data = await res.json();

      if (res.ok && data.converted) {
        setConvertDialogOpen(false);
        setConvertingEnquiryId(null);
        setSelectedCustomerId("");
        router.push(`/tickets/${data.ticket.id}`);
      } else if (data.needsCustomer) {
        setConvertError("Customer is required to create a ticket");
      } else if (!res.ok) {
        setConvertError(data.reason || data.error || `Failed with status ${res.status}`);
      } else {
        // Work item created but no ticket — refresh to show updated state
        setConvertDialogOpen(false);
        router.refresh();
      }
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : "Network error");
    } finally {
      setConverting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Enquiries</h1>
          <p className="text-xs text-[#666666] mt-1">
            Incoming enquiries from all channels
          </p>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                <Plus className="size-4 mr-1" />
                Add Enquiry
              </Button>
            }
          />
          <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
            <SheetHeader>
              <SheetTitle className="text-[#E0E0E0]">Add New Enquiry</SheetTitle>
              <SheetDescription className="text-[#666666]">
                Log a new enquiry from any source channel.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              <div className="space-y-1.5">
                <Label>Source Type</Label>
                <Select value={sourceType} onValueChange={(v) => setSourceType(v ?? "MANUAL")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_TYPES.map((st) => (
                      <SelectItem key={st} value={st}>
                        {st.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subjectOrLabel">Subject / Label</Label>
                <Input
                  id="subjectOrLabel"
                  name="subjectOrLabel"
                  placeholder="e.g. Steel delivery for Site A"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rawText">Raw Text *</Label>
                <Textarea
                  id="rawText"
                  name="rawText"
                  required
                  rows={4}
                  placeholder="Paste the original message or describe the enquiry..."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Enquiry Type</Label>
                <Select value={enquiryType} onValueChange={(v) => setEnquiryType(v ?? "DIRECT_ORDER")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {ENQUIRY_TYPES.map((et) => (
                      <SelectItem key={et} value={et}>
                        {et.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="receivedAt">Received At</Label>
                <Input
                  id="receivedAt"
                  name="receivedAt"
                  type="datetime-local"
                  defaultValue={new Date().toISOString().slice(0, 16)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Attachment</Label>
                <Input
                  type="file"
                  name="attachment"
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.eml"
                  className="text-xs"
                />
                <p className="text-[10px] text-[#666666]">Upload email screenshot, PDF, or document</p>
              </div>
              <SheetFooter>
                <Button type="submit" disabled={submitting} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                  {submitting ? "Creating..." : "Create Enquiry"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      {/* Convert to Work Item Dialog */}
      <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
        <DialogContent className="bg-[#1A1A1A] border-[#333333]">
          <DialogHeader>
            <DialogTitle>Convert to Work Item</DialogTitle>
            <DialogDescription>
              Select the ticket mode for this work item.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Customer *</Label>
              <Select value={selectedCustomerId} onValueChange={(v) => setSelectedCustomerId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Ticket Mode</Label>
              <Select value={selectedMode} onValueChange={(v) => setSelectedMode(v ?? "DIRECT_ORDER")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {convertError && (
            <div className="text-[#FF3333] text-xs border border-[#FF3333]/30 bg-[#FF3333]/10 px-3 py-2">
              {convertError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConvertDialogOpen(false); setConvertError(null); }} className="bg-[#222222] text-[#E0E0E0] border border-[#333333] hover:bg-[#2A2A2A]">
              Cancel
            </Button>
            <Button onClick={handleConvert} disabled={converting} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
              {converting ? "Converting..." : "Convert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="border border-[#333333] bg-[#1A1A1A]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject / Label</TableHead>
              <TableHead>Source Type</TableHead>
              <TableHead>Enquiry Type</TableHead>
              <TableHead>Source Contact</TableHead>
              <TableHead>Suggested Site</TableHead>
              <TableHead>Suggested Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Received At</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {enquiries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center py-8 text-[#888888]"
                >
                  No enquiries found. Add your first enquiry to get started.
                </TableCell>
              </TableRow>
            ) : (
              enquiries.map((enq) => (
                <TableRow key={enq.id}>
                  <TableCell className="font-medium max-w-[200px] truncate">
                    {enq.subjectOrLabel || enq.rawText.slice(0, 40)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {enq.sourceType.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {enq.enquiryType.replace(/_/g, " ")}
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {enq.sourceContact?.fullName || "\u2014"}
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {enq.suggestedSite?.siteName || "\u2014"}
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {enq.suggestedCustomer?.name || "\u2014"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusColor(enq.status)}>
                      {enq.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[#888888] tabular-nums">
                    {new Date(enq.receivedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setConvertingEnquiryId(enq.id);
                        setConvertDialogOpen(true);
                      }}
                      disabled={enq.status === "CONVERTED"}
                      title={
                        enq.status === "CONVERTED"
                          ? "Already converted to ticket"
                          : "Convert to Ticket"
                      }
                    >
                      <ArrowRightCircle className="size-4 mr-1" />
                      {enq.status === "CONVERTED" ? "Done" : "Convert"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
