"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  Building2,
  Plus,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
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
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";

type Customer = {
  id: string;
  name: string;
};

type CommercialLink = {
  id: string;
  role: string;
  billingAllowed: boolean;
  defaultBillingCustomer: boolean;
  isActive: boolean;
  customer: Customer;
};

type ContactLink = {
  id: string;
  roleOnSite: string | null;
  isPrimary: boolean;
  isActive: boolean;
  contact: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
  };
  customer: Customer | null;
};

type Ticket = {
  id: string;
  title: string;
  status: string;
  ticketMode: string;
  createdAt: string | Date;
  payingCustomer: Customer;
};

type Site = {
  id: string;
  siteName: string;
  siteCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  notes: string | null;
  aliases: string[];
  isActive: boolean;
  siteCommercialLinks: CommercialLink[];
  siteContactLinks: ContactLink[];
  tickets: Ticket[];
};

const ticketStatusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  CAPTURED: "outline",
  PRICING: "secondary",
  QUOTED: "secondary",
  APPROVED: "default",
  ORDERED: "default",
  DELIVERED: "default",
  COSTED: "secondary",
  PENDING_PO: "destructive",
  RECOVERY: "destructive",
  VERIFIED: "default",
  LOCKED: "secondary",
  INVOICED: "default",
  CLOSED: "outline",
};

type SupplierBillLineRow = {
  id: string;
  description: string;
  qty: number | string;
  unitCost: number | string;
  lineTotal: number | string;
  allocationStatus: string;
  costClassification: string;
  supplierBill: { id: string; billNo: string; billDate: string; supplier: { id: string; name: string } };
  ticket: { id: string; ticketNo: number; title: string } | null;
  customer: { id: string; name: string } | null;
};

export function SiteDetail({
  site,
  customers,
  supplierBillLines = [],
}: {
  site: Site;
  customers: Customer[];
  supplierBillLines?: SupplierBillLineRow[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [aliases, setAliases] = useState<string[]>(site.aliases || []);

  async function handleSiteUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const form = e.currentTarget;
    const formData = new FormData(form);

    const body = {
      siteName: formData.get("siteName") as string,
      siteCode: formData.get("siteCode") as string || null,
      addressLine1: formData.get("addressLine1") as string || null,
      addressLine2: formData.get("addressLine2") as string || null,
      city: formData.get("city") as string || null,
      postcode: formData.get("postcode") as string || null,
      country: formData.get("country") as string || null,
      notes: formData.get("notes") as string || null,
      aliases: aliases.filter((a) => a.trim()),
    };

    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCommercialLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLinkSubmitting(true);
    const form = e.currentTarget;
    const formData = new FormData(form);

    const body = {
      customerId: selectedCustomerId,
      role: formData.get("role") as string,
      billingAllowed: (formData.get("billingAllowed") as string) === "on",
      defaultBillingCustomer: (formData.get("defaultBillingCustomer") as string) === "on",
    };

    try {
      const res = await fetch(`/api/sites/${site.id}/commercial-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        form.reset();
        setSelectedCustomerId("");
        setLinkOpen(false);
        router.refresh();
      }
    } finally {
      setLinkSubmitting(false);
    }
  }

  const addressParts = [
    site.addressLine1,
    site.addressLine2,
    site.city,
    site.postcode,
    site.country,
  ].filter(Boolean);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/sites"
          className="inline-flex items-center gap-1 text-sm text-[#888888] hover:text-[#FF6600] mb-3"
        >
          <ArrowLeft className="size-3.5" />
          Back to Sites
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-[#E0E0E0]">
                {site.siteName}
              </h1>
              {site.siteCode && (
                <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[#3399FF]/10 text-[#3399FF]">{site.siteCode}</span>
              )}
              <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${site.isActive ? "bg-[#00CC66]/10 text-[#00CC66]" : "bg-[#888888]/10 text-[#888888]"}`}>
                {site.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            {addressParts.length > 0 && (
              <p className="flex items-center gap-1.5 text-sm text-[#888888] mt-1">
                <MapPin className="size-3.5" />
                {addressParts.join(", ")}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="commercial-links">
            Commercial Links ({site.siteCommercialLinks.length})
          </TabsTrigger>
          <TabsTrigger value="contacts">
            Contacts ({site.siteContactLinks.length})
          </TabsTrigger>
          <TabsTrigger value="tickets">
            Tickets ({site.tickets.length})
          </TabsTrigger>
          <TabsTrigger value="bills">
            Supplier Bills ({supplierBillLines.length})
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4">
          <div className="border border-[#333333] bg-[#1A1A1A] p-6 max-w-2xl">
            {editing ? (
              <form onSubmit={handleSiteUpdate} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-siteName">Site Name *</Label>
                  <Input
                    id="edit-siteName"
                    name="siteName"
                    defaultValue={site.siteName}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-siteCode">Site Code</Label>
                  <Input
                    id="edit-siteCode"
                    name="siteCode"
                    defaultValue={site.siteCode || ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-addressLine1">Address Line 1</Label>
                  <Input
                    id="edit-addressLine1"
                    name="addressLine1"
                    defaultValue={site.addressLine1 || ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-addressLine2">Address Line 2</Label>
                  <Input
                    id="edit-addressLine2"
                    name="addressLine2"
                    defaultValue={site.addressLine2 || ""}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-city">City</Label>
                    <Input
                      id="edit-city"
                      name="city"
                      defaultValue={site.city || ""}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-postcode">Postcode</Label>
                    <Input
                      id="edit-postcode"
                      name="postcode"
                      defaultValue={site.postcode || ""}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-country">Country</Label>
                  <Input
                    id="edit-country"
                    name="country"
                    defaultValue={site.country || ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-notes">Notes</Label>
                  <Textarea
                    id="edit-notes"
                    name="notes"
                    defaultValue={site.notes || ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Site Aliases (for matching)</Label>
                  <div className="text-[9px] text-[#666666]">Other names this site appears under in invoices/bills</div>
                  <div className="space-y-1">
                    {aliases.map((a, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input value={a} onChange={(e) => { const n = [...aliases]; n[i] = e.target.value; setAliases(n); }} className="flex-1 h-7 text-xs" />
                        <button type="button" onClick={() => setAliases(aliases.filter((_, j) => j !== i))} className="text-[#FF3333] text-xs px-1">✕</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setAliases([...aliases, ""])} className="text-[9px] text-[#FF6600] hover:text-[#FF9900]">+ Add alias</button>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={saving} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                    <Check className="size-4 mr-1" />
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditing(false)}
                    className="bg-[#222222] text-[#E0E0E0] border border-[#333333] hover:bg-[#2A2A2A]"
                  >
                    <X className="size-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Site Information</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(true)}
                    className="bg-[#222222] text-[#E0E0E0] border border-[#333333] hover:bg-[#2A2A2A]"
                  >
                    <Pencil className="size-3.5 mr-1" />
                    Edit
                  </Button>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm text-[#E0E0E0]">
                  <div>
                    <dt className="text-[#888888]">Site Name</dt>
                    <dd className="font-medium">{site.siteName}</dd>
                  </div>
                  <div>
                    <dt className="text-[#888888]">Site Code</dt>
                    <dd className="font-medium">{site.siteCode || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[#888888]">Address Line 1</dt>
                    <dd className="font-medium">
                      {site.addressLine1 || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#888888]">Address Line 2</dt>
                    <dd className="font-medium">
                      {site.addressLine2 || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#888888]">City</dt>
                    <dd className="font-medium">{site.city || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[#888888]">Postcode</dt>
                    <dd className="font-medium">{site.postcode || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[#888888]">Country</dt>
                    <dd className="font-medium">{site.country || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[#888888]">Status</dt>
                    <dd>
                      <Badge
                        variant={site.isActive ? "default" : "secondary"}
                      >
                        {site.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </dd>
                  </div>
                  {site.notes && (
                    <div className="col-span-2">
                      <dt className="text-[#888888]">Notes</dt>
                      <dd className="font-medium whitespace-pre-wrap">
                        {site.notes}
                      </dd>
                    </div>
                  )}
                  {site.aliases && site.aliases.length > 0 && (
                    <div className="col-span-2">
                      <dt className="text-[#888888]">Aliases (for matching)</dt>
                      <dd className="flex flex-wrap gap-1 mt-1">
                        {site.aliases.map((a: string, i: number) => (
                          <span key={i} className="text-xs px-2 py-0.5 bg-[#FF6600]/10 text-[#FF6600] border border-[#FF6600]/30">{a}</span>
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Commercial Links Tab */}
        <TabsContent value="commercial-links" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Commercial Links</h2>
            <Sheet open={linkOpen} onOpenChange={setLinkOpen}>
              <SheetTrigger
                render={
                  <Button size="sm" className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                    <Plus className="size-4 mr-1" />
                    Add Commercial Link
                  </Button>
                }
              />
              <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
                <SheetHeader>
                  <SheetTitle className="text-[#E0E0E0]">Add Commercial Link</SheetTitle>
                  <SheetDescription className="text-[#666666]">
                    Link a customer to this site with a commercial role.
                  </SheetDescription>
                </SheetHeader>
                <form
                  onSubmit={handleAddCommercialLink}
                  className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
                >
                  <div className="space-y-1.5">
                    <Label>Customer *</Label>
                    <Select
                      value={selectedCustomerId}
                      onValueChange={(value) => setSelectedCustomerId(value ?? "")}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a customer" />
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
                    <Label htmlFor="link-role">Role *</Label>
                    <Input
                      id="link-role"
                      name="role"
                      required
                      placeholder="e.g. Main Contractor, Sub-Contractor"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="link-billingAllowed"
                      name="billingAllowed"
                      className="size-4 rounded border-input accent-primary"
                    />
                    <Label htmlFor="link-billingAllowed">
                      Billing Allowed
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="link-defaultBillingCustomer"
                      name="defaultBillingCustomer"
                      className="size-4 rounded border-input accent-primary"
                    />
                    <Label htmlFor="link-defaultBillingCustomer">
                      Default Billing Customer
                    </Label>
                  </div>
                  <SheetFooter>
                    <Button
                      type="submit"
                      disabled={linkSubmitting || !selectedCustomerId}
                      className="bg-[#FF6600] text-black hover:bg-[#FF9900]"
                    >
                      {linkSubmitting ? "Adding..." : "Add Link"}
                    </Button>
                  </SheetFooter>
                </form>
              </SheetContent>
            </Sheet>
          </div>

          <div className="border border-[#333333] bg-[#1A1A1A]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Billing Allowed</TableHead>
                  <TableHead>Default Billing</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {site.siteCommercialLinks.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center py-8 text-[#888888]"
                    >
                      No commercial links. Add one to connect a customer to
                      this site.
                    </TableCell>
                  </TableRow>
                ) : (
                  site.siteCommercialLinks.map((link) => (
                    <TableRow key={link.id}>
                      <TableCell className="font-medium">
                        {link.customer.name}
                      </TableCell>
                      <TableCell>{link.role}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            link.billingAllowed ? "default" : "outline"
                          }
                        >
                          {link.billingAllowed ? "Yes" : "No"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            link.defaultBillingCustomer
                              ? "default"
                              : "outline"
                          }
                        >
                          {link.defaultBillingCustomer ? "Yes" : "No"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={link.isActive ? "default" : "secondary"}
                        >
                          {link.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Contacts Tab */}
        <TabsContent value="contacts" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Site Contacts</h2>
          </div>

          <div className="border border-[#333333] bg-[#1A1A1A]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role on Site</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Primary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {site.siteContactLinks.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-8 text-[#888888]"
                    >
                      No contacts linked to this site.
                    </TableCell>
                  </TableRow>
                ) : (
                  site.siteContactLinks.map((link) => (
                    <TableRow key={link.id}>
                      <TableCell className="font-medium">
                        {link.contact.fullName}
                      </TableCell>
                      <TableCell className="text-[#888888]">
                        {link.roleOnSite || "—"}
                      </TableCell>
                      <TableCell className="text-[#888888]">
                        {link.contact.phone || "—"}
                      </TableCell>
                      <TableCell className="text-[#888888]">
                        {link.contact.email || "—"}
                      </TableCell>
                      <TableCell className="text-[#888888]">
                        {link.customer?.name || "—"}
                      </TableCell>
                      <TableCell>
                        {link.isPrimary && (
                          <Badge variant="default">Primary</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Tickets Tab */}
        <TabsContent value="tickets" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Tickets</h2>
          </div>

          <div className="border border-[#333333] bg-[#1A1A1A]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Paying Customer</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {site.tickets.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center py-8 text-[#888888]"
                    >
                      No tickets on this site.
                    </TableCell>
                  </TableRow>
                ) : (
                  site.tickets.map((ticket) => (
                    <TableRow key={ticket.id} className="cursor-pointer hover:bg-[#222222]">
                      <TableCell>
                        <Link
                          href={`/tickets/${ticket.id}`}
                          className="font-medium text-[#FF6600] hover:text-[#FF9900] hover:underline"
                        >
                          {ticket.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {ticket.ticketMode.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            ticketStatusVariant[ticket.status] || "outline"
                          }
                        >
                          {ticket.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[#888888]">
                        {ticket.payingCustomer.name}
                      </TableCell>
                      <TableCell className="text-[#888888] tabular-nums">
                        {new Date(ticket.createdAt).toLocaleDateString(
                          "en-GB"
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Supplier Bills Tab — every bill line landed on this site */}
        <TabsContent value="bills" className="mt-4">
          <div className="border border-[#333333] bg-[#1A1A1A]">
            {supplierBillLines.length === 0 ? (
              <p className="text-sm text-[#888888] p-6">No supplier bill lines allocated to this site yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Bill #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Line Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplierBillLines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(l.supplierBill.billDate).toLocaleDateString("en-GB")}
                      </TableCell>
                      <TableCell>{l.supplierBill.supplier.name}</TableCell>
                      <TableCell>
                        <a href={`/procurement?bill=${l.supplierBill.id}`} className="text-primary hover:underline">
                          {l.supplierBill.billNo}
                        </a>
                      </TableCell>
                      <TableCell className="text-xs max-w-md truncate" title={l.description}>{l.description}</TableCell>
                      <TableCell>
                        {l.ticket ? (
                          <a href={`/tickets/${l.ticket.id}`} className="text-primary hover:underline text-xs">
                            #{l.ticket.ticketNo}
                          </a>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-xs">{l.customer?.name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(l.qty).toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">£{Number(l.lineTotal).toFixed(2)}</TableCell>
                      <TableCell><Badge variant="outline">{l.allocationStatus}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
