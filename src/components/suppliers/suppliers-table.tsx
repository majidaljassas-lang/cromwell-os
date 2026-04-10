"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  FileText,
  Package,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const PAYMENT_TERMS_OPTIONS = [
  "Net 7",
  "Net 14",
  "Net 30",
  "Net 45",
  "Net 60",
  "Pro Forma",
  "Cash",
  "EOM",
] as const;

type RecentOrder = {
  id: string;
  poNo: string;
  status: string;
  issuedAt: string | null;
  totalCostExpected: number | string;
};

type RecentBill = {
  id: string;
  billNo: string;
  billDate: string;
  status: string;
  totalCost: number | string;
};

type RecentReturn = {
  id: string;
  returnDate: string;
  status: string;
  notes: string | null;
};

type SupplierData = {
  id: string;
  name: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  cleanNotes: string | null;
  paymentTerms: string | null;
  accountRef: string | null;
  totalOwing: number;
  totalCredits: number;
  netBalance: number;
  recentOrders: RecentOrder[];
  recentBills: RecentBill[];
  recentReturns: RecentReturn[];
};

interface SuppliersTableProps {
  suppliers: SupplierData[];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

/** Encodes paymentTerms + accountRef into the notes field for storage */
function encodeNotesWithMeta(
  paymentTerms: string | null,
  accountRef: string | null,
  cleanNotes: string | null
): string | null {
  const meta: string[] = [];
  if (paymentTerms) meta.push(`paymentTerms:${paymentTerms}`);
  if (accountRef) meta.push(`accountRef:${accountRef}`);

  if (meta.length === 0) return cleanNotes || null;
  if (!cleanNotes) return meta.join("\n");
  return meta.join("\n") + "\n---\n" + cleanNotes;
}

export function SuppliersTable({ suppliers }: SuppliersTableProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editSupplier, setEditSupplier] = useState<SupplierData | null>(null);
  const [saving, setSaving] = useState(false);

  // Add form state for payment terms select
  const [addPaymentTerms, setAddPaymentTerms] = useState<string>("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = e.currentTarget;
    const fd = new FormData(form);

    const cleanNotes = (fd.get("notes") as string) || null;
    const accountRef = (fd.get("accountRef") as string) || null;

    const notes = encodeNotesWithMeta(
      addPaymentTerms || null,
      accountRef,
      cleanNotes
    );

    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name") as string,
          legalName: (fd.get("legalName") as string) || undefined,
          email: (fd.get("email") as string) || undefined,
          phone: (fd.get("phone") as string) || undefined,
          notes: notes || undefined,
        }),
      });
      if (res.ok) {
        form.reset();
        setAddPaymentTerms("");
        setAddOpen(false);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function openEditSheet(supplier: SupplierData) {
    setEditSupplier({ ...supplier });
    setEditOpen(true);
  }

  async function handleEditSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editSupplier) return;
    setSaving(true);
    const form = e.currentTarget;
    const fd = new FormData(form);

    const cleanNotes = (fd.get("editNotes") as string) || null;
    const paymentTerms = (fd.get("editPaymentTerms") as string) || null;
    const accountRef = (fd.get("editAccountRef") as string) || null;

    const notes = encodeNotesWithMeta(paymentTerms, accountRef, cleanNotes);

    try {
      const res = await fetch(`/api/suppliers/${editSupplier.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("editName") as string,
          legalName: (fd.get("editLegalName") as string) || null,
          notes: notes,
        }),
      });
      if (res.ok) {
        setEditOpen(false);
        setEditSupplier(null);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">
            Suppliers
          </h1>
          <p className="text-xs text-[#666666] mt-1">
            {suppliers.length} supplier{suppliers.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger
            render={
              <Button
                size="sm"
                className="bg-[#FF6600] text-black hover:bg-[#FF9900]"
              >
                <Plus className="size-4 mr-1" />
                Add Supplier
              </Button>
            }
          />
          <SheetContent
            side="right"
            className="bg-[#1A1A1A] border-[#333333]"
          >
            <SheetHeader>
              <SheetTitle className="text-[#E0E0E0]">Add Supplier</SheetTitle>
              <SheetDescription className="text-[#666666]">
                Add a new supplier to the system.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              <div className="space-y-1.5">
                <Label htmlFor="s-name">Name *</Label>
                <Input
                  id="s-name"
                  name="name"
                  required
                  placeholder="Supplier name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-legal">Legal Name</Label>
                <Input
                  id="s-legal"
                  name="legalName"
                  placeholder="Registered company name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-email">Email</Label>
                <Input
                  id="s-email"
                  name="email"
                  type="email"
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-phone">Phone</Label>
                <Input id="s-phone" name="phone" placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label>Payment Terms</Label>
                <Select
                  value={addPaymentTerms}
                  onValueChange={(v) => setAddPaymentTerms(v ?? "")}
                >
                  <SelectTrigger className="w-full bg-[#111111] border-[#333333] text-[#E0E0E0]">
                    <SelectValue placeholder="Select terms" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A1A1A] border-[#333333]">
                    {PAYMENT_TERMS_OPTIONS.map((term) => (
                      <SelectItem key={term} value={term}>
                        {term}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-accountRef">Account Ref</Label>
                <Input
                  id="s-accountRef"
                  name="accountRef"
                  placeholder="Their account number for you"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-notes">Notes</Label>
                <Textarea
                  id="s-notes"
                  name="notes"
                  placeholder="Optional"
                  rows={3}
                />
              </div>
              <SheetFooter>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="bg-[#FF6600] text-black hover:bg-[#FF9900]"
                >
                  {submitting ? "Adding..." : "Add Supplier"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      {/* Table */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Name</TableHead>
              <TableHead>Legal Name</TableHead>
              <TableHead>Payment Terms</TableHead>
              <TableHead className="text-right">Owing</TableHead>
              <TableHead className="text-right">Credits</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Account Ref</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-8 text-[#888888]"
                >
                  No suppliers yet. Add your first supplier.
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((s) => (
                <>
                  {/* Main row */}
                  <TableRow
                    key={s.id}
                    className="cursor-pointer hover:bg-[#222222]"
                    onClick={() => toggleExpand(s.id)}
                  >
                    <TableCell className="w-8 px-2">
                      {expandedId === s.id ? (
                        <ChevronDown className="size-4 text-[#888888]" />
                      ) : (
                        <ChevronRight className="size-4 text-[#888888]" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-[#E0E0E0]">
                      {s.name}
                    </TableCell>
                    <TableCell className="text-[#888888]">
                      {s.legalName || "\u2014"}
                    </TableCell>
                    <TableCell>
                      {s.paymentTerms ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-[#333333] text-[#E0E0E0]">
                          {s.paymentTerms}
                        </span>
                      ) : (
                        <span className="text-[#555555]">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[#E0E0E0]">
                      {s.totalOwing > 0
                        ? formatCurrency(s.totalOwing)
                        : "\u2014"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[#00CC66]">
                      {s.totalCredits > 0
                        ? formatCurrency(s.totalCredits)
                        : "\u2014"}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-medium ${
                        s.netBalance > 0
                          ? "text-[#FF6600]"
                          : s.netBalance < 0
                            ? "text-[#00CC66]"
                            : "text-[#888888]"
                      }`}
                    >
                      {s.netBalance !== 0
                        ? formatCurrency(s.netBalance)
                        : "\u2014"}
                    </TableCell>
                    <TableCell className="text-[#888888] text-xs">
                      {s.accountRef || "\u2014"}
                    </TableCell>
                  </TableRow>

                  {/* Expanded detail row */}
                  {expandedId === s.id && (
                    <TableRow key={`${s.id}-detail`} className="bg-[#111111]">
                      <TableCell colSpan={8} className="p-0">
                        <SupplierDetail
                          supplier={s}
                          onEdit={() => openEditSheet(s)}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
          <SheetHeader>
            <SheetTitle className="text-[#E0E0E0]">Edit Supplier</SheetTitle>
            <SheetDescription className="text-[#666666]">
              Update supplier details.
            </SheetDescription>
          </SheetHeader>
          {editSupplier && (
            <form
              onSubmit={handleEditSave}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Name *</Label>
                <Input
                  id="edit-name"
                  name="editName"
                  required
                  defaultValue={editSupplier.name}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-legal">Legal Name</Label>
                <Input
                  id="edit-legal"
                  name="editLegalName"
                  defaultValue={editSupplier.legalName || ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Payment Terms</Label>
                <select
                  name="editPaymentTerms"
                  defaultValue={editSupplier.paymentTerms || ""}
                  className="flex h-8 w-full rounded-lg border border-[#333333] bg-[#111111] px-2.5 py-1.5 text-sm text-[#E0E0E0] outline-none focus:border-[#FF6600]"
                >
                  <option value="">None</option>
                  {PAYMENT_TERMS_OPTIONS.map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-accountRef">Account Ref</Label>
                <Input
                  id="edit-accountRef"
                  name="editAccountRef"
                  defaultValue={editSupplier.accountRef || ""}
                  placeholder="Their account number for you"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  id="edit-notes"
                  name="editNotes"
                  defaultValue={editSupplier.cleanNotes || ""}
                  rows={4}
                  placeholder="Additional notes"
                />
              </div>
              <SheetFooter>
                <Button
                  type="submit"
                  disabled={saving}
                  className="bg-[#FF6600] text-black hover:bg-[#FF9900]"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </SheetFooter>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Expanded supplier detail panel                                     */
/* ------------------------------------------------------------------ */
function SupplierDetail({
  supplier,
  onEdit,
}: {
  supplier: SupplierData;
  onEdit: () => void;
}) {
  return (
    <div className="p-4 space-y-4 border-t border-[#222222]">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-xs text-[#888888]">
            {supplier.email && (
              <span className="mr-4">{supplier.email}</span>
            )}
            {supplier.phone && <span>{supplier.phone}</span>}
          </div>
          {supplier.cleanNotes && (
            <p className="text-xs text-[#666666] max-w-lg">{supplier.cleanNotes}</p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-[#333333] text-[#E0E0E0] hover:bg-[#222222]"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          Edit
        </Button>
      </div>

      {/* Three-column grid: Orders / Bills / Returns */}
      <div className="grid grid-cols-3 gap-4">
        {/* Recent Orders */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Package className="size-3.5 text-[#3399FF]" />
            <span className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">
              Recent Orders
            </span>
          </div>
          {supplier.recentOrders.length === 0 ? (
            <p className="text-xs text-[#555555]">No orders</p>
          ) : (
            <div className="space-y-1">
              {supplier.recentOrders.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between text-xs py-1 border-b border-[#1A1A1A]"
                >
                  <div>
                    <span className="text-[#E0E0E0] font-mono">{o.poNo}</span>
                    <span className="text-[#555555] ml-2">
                      {formatDate(o.issuedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#888888] tabular-nums">
                      {formatCurrency(Number(o.totalCostExpected))}
                    </span>
                    <StatusDot status={o.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Bills */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <FileText className="size-3.5 text-[#FF6600]" />
            <span className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">
              Recent Bills
            </span>
          </div>
          {supplier.recentBills.length === 0 ? (
            <p className="text-xs text-[#555555]">No bills</p>
          ) : (
            <div className="space-y-1">
              {supplier.recentBills.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between text-xs py-1 border-b border-[#1A1A1A]"
                >
                  <div>
                    <span className="text-[#E0E0E0] font-mono">{b.billNo}</span>
                    <span className="text-[#555555] ml-2">
                      {formatDate(b.billDate)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#888888] tabular-nums">
                      {formatCurrency(Number(b.totalCost))}
                    </span>
                    <StatusDot status={b.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Returns */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <RotateCcw className="size-3.5 text-[#FF3333]" />
            <span className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">
              Recent Returns
            </span>
          </div>
          {supplier.recentReturns.length === 0 ? (
            <p className="text-xs text-[#555555]">No returns</p>
          ) : (
            <div className="space-y-1">
              {supplier.recentReturns.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between text-xs py-1 border-b border-[#1A1A1A]"
                >
                  <div>
                    <span className="text-[#555555]">
                      {formatDate(r.returnDate)}
                    </span>
                    {r.notes && (
                      <span className="text-[#888888] ml-2 truncate max-w-[120px] inline-block align-bottom">
                        {r.notes}
                      </span>
                    )}
                  </div>
                  <StatusDot status={r.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const lower = status.toLowerCase();
  let color = "#888888";
  if (
    lower.includes("complete") ||
    lower.includes("paid") ||
    lower.includes("resolved")
  ) {
    color = "#00CC66";
  } else if (
    lower.includes("pending") ||
    lower.includes("draft") ||
    lower.includes("open")
  ) {
    color = "#FF6600";
  } else if (
    lower.includes("cancelled") ||
    lower.includes("rejected") ||
    lower.includes("void")
  ) {
    color = "#FF3333";
  } else if (lower.includes("sent") || lower.includes("issued")) {
    color = "#3399FF";
  }

  return (
    <span
      className="inline-block size-2 rounded-full shrink-0"
      style={{ backgroundColor: color }}
      title={status}
    />
  );
}
