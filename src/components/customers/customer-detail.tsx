"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Plus, Check, X, Pencil, Users, Tag, Trash2, Network, Search, ChevronDown, ChevronRight } from "lucide-react";
import { SiteEmbedded } from "@/components/sites/site-embedded";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ZohoCustomerHistoryTab } from "@/components/zoho/ZohoCustomerHistoryTab";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaymentTermsSelect } from "@/components/shared/payment-terms-select";

type CustomerAlias = {
  id: string;
  aliasText: string;
  aliasSource: string | null;
  confidenceScore: number | null;
  manualConfirmed: boolean;
  createdAt: string;
};

type Customer = {
  id: string;
  name: string;
  legalName: string | null;
  companyNumber: string | null;
  billingAddress: string | null;
  vatNumber: string | null;
  paymentTerms: string | null;
  poRequiredDefault: boolean;
  podRequired: boolean;
  isCashCustomer: boolean;
  isBillingEntity: boolean;
  parentCustomerEntityId: string | null;
  entityType: string | null;
  defaultCustomerMode: string | null;
  defaultMarginPct: number | string | null;
  notes: string | null;
  parentEntity: { id: string; name: string; isBillingEntity: boolean } | null;
  subsidiaries: Array<{ id: string; name: string; legalName: string | null; isBillingEntity: boolean }>;
  customerAliases: CustomerAlias[];
  siteCommercialLinks: Array<{
    id: string;
    role: string;
    billingAllowed: boolean;
    defaultBillingCustomer: boolean;
    site: { id: string; siteName: string; siteCode: string | null; city: string | null; postcode: string | null; aliases: string[] };
  }>;
  siteContactLinks: Array<{
    id: string;
    roleOnSite: string | null;
    contact: { id: string; fullName: string; phone: string | null; email: string | null };
  }>;
  ticketsAsPayer: Array<{
    id: string; title: string; status: string; ticketMode: string; createdAt: string;
    sourceEntityId?: string | null; sourceEntityName?: string | null;
  }>;
  customerPOs: Array<{
    id: string; poNo: string; poType: string; status: string; totalValue: number | null;
    sourceEntityId?: string | null; sourceEntityName?: string | null;
  }>;
  invoices?: Array<{
    id: string;
    invoiceNo: string | null;
    issuedAt: string | null;
    dueDate: string | null;
    paidAt: string | null;
    totalSell: number | string;
    totalGross: number | string;
    status: string;
    sourceEntityId?: string | null;
    sourceEntityName?: string | null;
  }>;
};

type EffectiveBillingProp = {
  billingAddress: string | null;
  billingEmail: string | null;
  paymentTerms: string | null;
  creditLimit: string | number | null;
  vatNumber: string | null;
  currency: string | null;
  sources: {
    billingAddress: string | null;
    billingEmail: string | null;
    paymentTerms: string | null;
    creditLimit: string | null;
    vatNumber: string | null;
    currency: string | null;
  };
};

type SupplierBillLineRow = {
  id: string;
  description: string;
  qty: number | string;
  unitCost: number | string;
  lineTotal: number | string;
  allocationStatus: string;
  supplierBill: { id: string; billNo: string; billDate: string; supplier: { id: string; name: string } };
  ticket: { id: string; ticketNo: number; title: string } | null;
  site: { id: string; siteName: string } | null;
};

export function CustomerDetail({
  customer,
  allSites,
  allCustomers,
  supplierBillLines = [],
  embedded = false,
  isBucket = false,
  effective = null,
  inheritSourceNames = {},
}: {
  customer: Customer;
  allSites: Array<{ id: string; siteName: string }>;
  allCustomers: Array<{ id: string; name: string }>;
  supplierBillLines?: SupplierBillLineRow[];
  embedded?: boolean;
  isBucket?: boolean;
  effective?: EffectiveBillingProp | null;
  inheritSourceNames?: Record<string, string>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState("");

  // Alias management
  const [newAlias, setNewAlias] = useState("");
  const [addingAlias, setAddingAlias] = useState(false);

  // Hierarchy
  const [setParentOpen, setSetParentOpen] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState(customer.parentCustomerEntityId || "");
  const [savingParent, setSavingParent] = useState(false);

  // Add subsidiary
  const [addSubOpen, setAddSubOpen] = useState(false);
  const [selectedSubId, setSelectedSubId] = useState("");
  const [savingSub, setSavingSub] = useState(false);

  // Add contact
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [addingContact, setAddingContact] = useState(false);

  // Create new subsidiary (inherits commercial defaults from this parent)
  const [createSubOpen, setCreateSubOpen] = useState(false);
  const [creatingSub, setCreatingSub] = useState(false);
  const [subName, setSubName] = useState("");
  const [subLegalName, setSubLegalName] = useState("");
  const [expandedSiteIds, setExpandedSiteIds] = useState<Set<string>>(new Set());
  const [subCompanyNumber, setSubCompanyNumber] = useState("");
  const [subVatNumber, setSubVatNumber] = useState("");
  const [subBillingAddress, setSubBillingAddress] = useState("");
  // Inheritable commercial defaults — pre-filled from parent, user can override.
  const [subPaymentTerms, setSubPaymentTerms] = useState(customer.paymentTerms || "Net 30");
  const [subPoRequired, setSubPoRequired] = useState(customer.poRequiredDefault);
  const [subIsBillingEntity, setSubIsBillingEntity] = useState(true);
  const [subLookingUp, setSubLookingUp] = useState(false);
  const [subLookupError, setSubLookupError] = useState<string | null>(null);
  const [subError, setSubError] = useState<string | null>(null);

  async function handleSubCompaniesHouseLookup() {
    const cleaned = subCompanyNumber.replace(/\s+/g, "");
    if (!cleaned) {
      setSubLookupError("Enter a company number first");
      return;
    }
    setSubLookupError(null);
    setSubLookingUp(true);
    try {
      const res = await fetch(`/api/companies-house/${encodeURIComponent(cleaned)}`);
      const data = await res.json();
      if (res.status === 503) {
        window.open(
          `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(cleaned)}`,
          "_blank",
          "noopener,noreferrer"
        );
        setSubLookupError("No API key set — opened Companies House in a new tab.");
        return;
      }
      if (!res.ok) {
        setSubLookupError(data.error || "Lookup failed");
        return;
      }
      if (data.legalName) {
        setSubLegalName(data.legalName);
        if (!subName) setSubName(data.legalName);
      }
      if (data.billingAddress) setSubBillingAddress(data.billingAddress);
      if (data.companyNumber) setSubCompanyNumber(data.companyNumber);
    } catch (err) {
      setSubLookupError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubLookingUp(false);
    }
  }

  async function handleCreateSubsidiary() {
    if (!subName.trim()) {
      setSubError("Name is required");
      return;
    }
    setSubError(null);
    setCreatingSub(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: subName.trim(),
          legalName: subLegalName.trim() || null,
          companyNumber: subCompanyNumber.replace(/\s+/g, "") || null,
          vatNumber: subVatNumber.trim() || null,
          billingAddress: subBillingAddress.trim() || null,
          paymentTerms: subPaymentTerms || null,
          poRequiredDefault: subPoRequired,
          isBillingEntity: subIsBillingEntity,
          entityType: "SUBSIDIARY",
          parentCustomerEntityId: customer.id,
          // Inherit pricing/mode defaults so quoting behaves consistently across the group.
          defaultMarginPct: customer.defaultMarginPct ?? null,
          defaultCustomerMode: customer.defaultCustomerMode ?? null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubError(data.error || "Failed to create subsidiary");
        return;
      }
      // Reset and close
      setSubName("");
      setSubLegalName("");
      setSubCompanyNumber("");
      setSubVatNumber("");
      setSubBillingAddress("");
      setSubPaymentTerms(customer.paymentTerms || "Net 30");
      setSubPoRequired(customer.poRequiredDefault);
      setSubIsBillingEntity(true);
      setCreateSubOpen(false);
      router.refresh();
    } catch (err) {
      setSubError(err instanceof Error ? err.message : "Network error");
    } finally {
      setCreatingSub(false);
    }
  }

  // Companies House lookup
  const [companyNumber, setCompanyNumber] = useState(customer.companyNumber || "");
  const [legalName, setLegalName] = useState(customer.legalName || "");
  const [billingAddress, setBillingAddress] = useState(customer.billingAddress || "");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupOk, setLookupOk] = useState<string | null>(null);

  async function handleCompaniesHouseLookup() {
    const cleaned = companyNumber.replace(/\s+/g, "");
    if (!cleaned) {
      setLookupError("Enter a company number first");
      return;
    }
    setLookupError(null);
    setLookupOk(null);
    setLookingUp(true);
    try {
      const res = await fetch(`/api/companies-house/${encodeURIComponent(cleaned)}`);
      const data = await res.json();
      // 503 = no API key configured. Fall back to opening the Companies
      // House public website so the user can still see the registered
      // details rather than hitting a dead end.
      if (res.status === 503) {
        window.open(
          `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(cleaned)}`,
          "_blank",
          "noopener,noreferrer"
        );
        setLookupError("No API key set — opened Companies House in a new tab. Add COMPANIES_HOUSE_API_KEY to .env for inline auto-fill.");
        return;
      }
      if (!res.ok) {
        setLookupError(data.error || "Lookup failed");
        return;
      }
      if (data.legalName) setLegalName(data.legalName);
      if (data.billingAddress) setBillingAddress(data.billingAddress);
      if (data.companyNumber) setCompanyNumber(data.companyNumber);
      setLookupOk(`Found: ${data.companyName}`);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLookingUp(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete customer "${customer.name}"? This will remove all aliases and site links.`)) return;
    await fetch(`/api/customers/${customer.id}`, { method: "DELETE" });
    router.push("/customers");
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const body = {
      name: fd.get("name") as string,
      legalName: legalName || null,
      companyNumber: companyNumber.replace(/\s+/g, "") || null,
      billingAddress: billingAddress || null,
      vatNumber: (fd.get("vatNumber") as string) || null,
      paymentTerms: (fd.get("paymentTerms") as string) || null,
      notes: (fd.get("notes") as string) || null,
      poRequiredDefault: fd.get("poRequired") === "on",
      podRequired:       fd.get("podRequired") === "on",
      entityType: (fd.get("entityType") as string) || null,
      isBillingEntity: fd.get("isBillingEntity") === "on",
    };
    await fetch(`/api/customers/${customer.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  async function handleLinkSite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedSiteId) return;
    setLinkSubmitting(true);
    const fd = new FormData(e.currentTarget);
    await fetch(`/api/sites/${selectedSiteId}/commercial-links`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: customer.id,
        role: (fd.get("role") as string) || "Main Contractor",
        billingAllowed: fd.get("billingAllowed") === "on",
        defaultBillingCustomer: fd.get("defaultBilling") === "on",
      }),
    });
    setLinkSubmitting(false);
    setLinkOpen(false);
    setSelectedSiteId("");
    router.refresh();
  }

  async function handleAddAlias() {
    if (!newAlias.trim()) return;
    setAddingAlias(true);
    await fetch("/api/customer-aliases", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: customer.id, aliasText: newAlias.trim() }),
    });
    setNewAlias("");
    setAddingAlias(false);
    router.refresh();
  }

  async function handleDeleteAlias(aliasId: string) {
    await fetch(`/api/customer-aliases?id=${aliasId}`, { method: "DELETE" });
    router.refresh();
  }

  async function handleSetParent() {
    setSavingParent(true);
    await fetch(`/api/customers/${customer.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentCustomerEntityId: selectedParentId || null }),
    });
    setSavingParent(false);
    setSetParentOpen(false);
    router.refresh();
  }

  async function handleAddSubsidiary() {
    if (!selectedSubId) return;
    setSavingSub(true);
    await fetch(`/api/customers/${selectedSubId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentCustomerEntityId: customer.id }),
    });
    setSavingSub(false);
    setAddSubOpen(false);
    setSelectedSubId("");
    router.refresh();
  }

  async function handleRemoveSubsidiary(subId: string) {
    await fetch(`/api/customers/${subId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentCustomerEntityId: null }),
    });
    router.refresh();
  }

  async function handleAddContact(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddingContact(true);
    const fd = new FormData(e.currentTarget);
    const contactBody = {
      fullName: fd.get("contactName") as string,
      phone: (fd.get("contactPhone") as string) || null,
      email: (fd.get("contactEmail") as string) || null,
      notes: (fd.get("contactNotes") as string) || null,
    };

    try {
      // Create the contact
      const contactRes = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactBody),
      });

      if (contactRes.ok) {
        const newContact = await contactRes.json();

        // Get the first linked site to create a SiteContactLink
        // If customer has linked sites, use the first one; otherwise we need a site
        const firstSiteLink = customer.siteCommercialLinks[0];
        if (firstSiteLink) {
          await fetch(`/api/sites/${firstSiteLink.site.id}/contact-links`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contactId: newContact.id,
              customerId: customer.id,
              roleOnSite: (fd.get("contactRole") as string) || null,
            }),
          });
        }

        setAddContactOpen(false);
        router.refresh();
      }
    } finally {
      setAddingContact(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      {!embedded && (
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link href="/customers"><Button variant="ghost" size="sm"><ArrowLeft className="size-4 mr-1" />Back</Button></Link>
            <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">{customer.name}</h1>
          </div>
          <div className="flex items-center gap-2 ml-[72px] text-xs text-[#888888]">
            {customer.legalName && <span>{customer.legalName}</span>}
            {customer.poRequiredDefault && <Badge className="text-[8px] px-1 py-0 text-[#FF9900] bg-[#FF9900]/10">PO REQUIRED</Badge>}
            {customer.podRequired && <Badge className="text-[8px] px-1 py-0 text-[#3399FF] bg-[#3399FF]/10" title="Invoice send is blocked until POD is uploaded for every line.">POD REQUIRED</Badge>}
            {customer.isCashCustomer && <Badge className="text-[8px] px-1 py-0 text-[#00CC66] bg-[#00CC66]/10">CASH</Badge>}
            {customer.isBillingEntity ? (
              <Badge className="text-[8px] px-1 py-0 text-[#3399FF] bg-[#3399FF]/10">BILLING ENTITY</Badge>
            ) : (
              <Badge className="text-[8px] px-1 py-0 text-[#FF9900] bg-[#FF9900]/10" title="Not a real legal entity — used to group subsidiaries.">GROUPING ONLY</Badge>
            )}
            {customer.parentEntity && (
              <Link href={`/customers/${customer.parentEntity.id}`}>
                <Badge className="text-[8px] px-1 py-0 text-[#FF6600] bg-[#FF6600]/10 cursor-pointer hover:bg-[#FF6600]/20">
                  PARENT: {customer.parentEntity.name}
                </Badge>
              </Link>
            )}
            {isBucket && (
              <Badge
                className="text-[8px] px-1 py-0 text-[#FFCC00] bg-[#FFCC00]/10"
                title={`Group view — totals across ${customer.subsidiaries.length} subsidiar${customer.subsidiaries.length === 1 ? "y" : "ies"}.`}
              >
                ★ GROUP VIEW · {customer.subsidiaries.length} SUB{customer.subsidiaries.length === 1 ? "" : "S"}
              </Badge>
            )}
            {customer.entityType && <Badge className="text-[8px] px-1 py-0 text-[#888888] bg-[#333333]">{customer.entityType}</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDelete} className="bg-[#222222] text-[#FF3333] border-[#FF3333]/30 hover:bg-[#FF3333]/10">
            <Trash2 className="size-3.5 mr-1" />Delete
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditing(!editing)} className="bg-[#222222] border-[#333333] text-[#E0E0E0]">
            <Pencil className="size-3.5 mr-1" />{editing ? "Cancel" : "Edit"}
          </Button>
        </div>
      </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="hierarchy">Hierarchy ({customer.subsidiaries.length})</TabsTrigger>
          <TabsTrigger value="aliases">Aliases ({customer.customerAliases.length})</TabsTrigger>
          {!embedded && <TabsTrigger value="sites">Sites ({customer.siteCommercialLinks.length})</TabsTrigger>}
          <TabsTrigger value="tickets">Tickets ({customer.ticketsAsPayer.length})</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({customer.siteContactLinks.length})</TabsTrigger>
          <TabsTrigger value="bills">Supplier Bills ({supplierBillLines.length})</TabsTrigger>
          <TabsTrigger value="zoho">Historical (Zoho)</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* LEFT RAIL */}
            <div className="lg:col-span-1 space-y-4">
          <div className="border border-[#333333] bg-[#1A1A1A] p-6">
            {editing ? (
              <form onSubmit={handleSave} className="space-y-4">
                <div className="space-y-1.5"><Label>Customer Name *</Label><Input name="name" defaultValue={customer.name} required /></div>
                <div className="space-y-1.5">
                  <Label>Company Number (UK)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={companyNumber}
                      onChange={(e) => setCompanyNumber(e.target.value)}
                      placeholder="e.g. 10611686"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCompaniesHouseLookup}
                      disabled={lookingUp || !companyNumber.trim()}
                      className="bg-[#222222] border-[#333333] text-[#E0E0E0]"
                    >
                      <Search className="size-3.5 mr-1" />
                      {lookingUp ? "Looking up..." : "Lookup"}
                    </Button>
                  </div>
                  {lookupError && <p className="text-[10px] text-[#FF3333]">{lookupError}</p>}
                  {lookupOk && <p className="text-[10px] text-[#00CC66]">{lookupOk} — name &amp; address auto-filled.</p>}
                </div>
                <div className="space-y-1.5"><Label>Legal Name</Label><Input value={legalName} onChange={(e) => setLegalName(e.target.value)} /></div>
                <div className="space-y-1.5">
                  <Label>Billing Address</Label>
                  <textarea
                    value={billingAddress}
                    onChange={(e) => setBillingAddress(e.target.value)}
                    rows={4}
                    className="w-full bg-[#222222] border border-[#333333] text-[#E0E0E0] text-sm px-3 py-2 font-mono"
                    placeholder="One line per address line"
                  />
                </div>
                <div className="space-y-1.5"><Label>VAT Number</Label><Input name="vatNumber" defaultValue={customer.vatNumber || ""} /></div>
                <div className="space-y-1.5">
                  <Label>Payment Terms</Label>
                  <PaymentTermsSelect name="paymentTerms" defaultValue={customer.paymentTerms} />
                </div>
                <div className="space-y-1.5"><Label>Entity Type</Label><Input name="entityType" defaultValue={customer.entityType || ""} placeholder="e.g. HEAD_OFFICE, DIVISION, SUBSIDIARY" /></div>
                <div className="space-y-1.5"><Label>Notes</Label><Input name="notes" defaultValue={customer.notes || ""} /></div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" name="poRequired" id="poRequired" defaultChecked={customer.poRequiredDefault} />
                    <Label htmlFor="poRequired">PO Required</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" name="podRequired" id="podRequired" defaultChecked={customer.podRequired} />
                    <Label htmlFor="podRequired" title="Block invoice send until proof of delivery is uploaded for every line.">POD Required</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" name="isBillingEntity" id="isBillingEntity" defaultChecked={customer.isBillingEntity} />
                    <Label htmlFor="isBillingEntity" title="Untick if this is just a name/grouping, not a real legal entity that gets invoiced.">Billing Entity</Label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={saving} className="bg-[#FF6600] text-black hover:bg-[#FF9900]"><Check className="size-4 mr-1" />{saving ? "Saving..." : "Save"}</Button>
                  <Button type="button" variant="outline" onClick={() => setEditing(false)} className="bg-[#222222] border-[#333333] text-[#E0E0E0]"><X className="size-4 mr-1" />Cancel</Button>
                </div>
              </form>
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-[#888888]">Name</dt><dd className="font-medium">{customer.name}</dd></div>
                <div><dt className="text-[#888888]">Legal Name</dt><dd>{customer.legalName || "—"}</dd></div>
                <div>
                  <dt className="text-[#888888]">Company Number</dt>
                  <dd>
                    {customer.companyNumber ? (
                      <a
                        href={`https://find-and-update.company-information.service.gov.uk/company/${customer.companyNumber}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#FF6600] hover:underline bb-mono"
                      >
                        {customer.companyNumber}
                      </a>
                    ) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#888888]">VAT Number</dt>
                  <dd>
                    <EffectiveValue
                      own={customer.vatNumber}
                      effective={effective?.vatNumber ?? null}
                      sourceId={effective?.sources.vatNumber ?? null}
                      selfId={customer.id}
                      sourceNames={inheritSourceNames}
                    />
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[#888888]">Billing Address</dt>
                  <dd className="whitespace-pre-line">
                    <EffectiveValue
                      own={customer.billingAddress}
                      effective={effective?.billingAddress ?? null}
                      sourceId={effective?.sources.billingAddress ?? null}
                      selfId={customer.id}
                      sourceNames={inheritSourceNames}
                    />
                  </dd>
                </div>
                <div>
                  <dt className="text-[#888888]">Payment Terms</dt>
                  <dd>
                    <EffectiveValue
                      own={customer.paymentTerms}
                      effective={effective?.paymentTerms ?? null}
                      sourceId={effective?.sources.paymentTerms ?? null}
                      selfId={customer.id}
                      sourceNames={inheritSourceNames}
                    />
                  </dd>
                </div>
                <div><dt className="text-[#888888]">Entity Type</dt><dd>{customer.entityType || "—"}</dd></div>
                <div><dt className="text-[#888888]">PO Required</dt><dd>{customer.poRequiredDefault ? "Yes" : "No"}</dd></div>
                <div><dt className="text-[#888888]">POD Required</dt><dd>{customer.podRequired ? "Yes" : "No"}</dd></div>
                <div><dt className="text-[#888888]">Billing Entity</dt><dd>{customer.isBillingEntity ? "Yes" : "No"}</dd></div>
                {customer.notes && <div className="col-span-2"><dt className="text-[#888888]">Notes</dt><dd>{customer.notes}</dd></div>}
              </dl>
            )}
          </div>

          {/* Linked Sites — compact */}
          <div className="border border-[#333333] bg-[#1A1A1A] p-4">
            <div className="text-[10px] uppercase tracking-widest text-[#888888] font-bold mb-2">
              Linked Sites ({customer.siteCommercialLinks.length})
            </div>
            {customer.siteCommercialLinks.length === 0 ? (
              <div className="text-xs text-[#666666]">None</div>
            ) : (
              <div className="space-y-1">
                {customer.siteCommercialLinks.map((link) => (
                  <Link key={link.id} href={`/sites/${link.site.id}`} className="block hover:bg-[#222222] -mx-2 px-2 py-1">
                    <div className="text-xs text-[#E0E0E0] truncate">{link.site.siteName}</div>
                    <div className="text-[9px] text-[#666666]">
                      {link.site.city || ""}{link.site.postcode ? ` · ${link.site.postcode}` : ""}
                      {link.role ? ` · ${link.role}` : ""}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Contacts — compact */}
          <div className="border border-[#333333] bg-[#1A1A1A] p-4">
            <div className="text-[10px] uppercase tracking-widest text-[#888888] font-bold mb-2">
              Contacts ({customer.siteContactLinks.length})
            </div>
            {customer.siteContactLinks.length === 0 ? (
              <div className="text-xs text-[#666666]">No primary contact</div>
            ) : (
              <div className="space-y-2">
                {customer.siteContactLinks.slice(0, 5).map((cl) => (
                  <div key={cl.id} className="text-xs">
                    <div className="text-[#E0E0E0] font-medium">{cl.contact.fullName}</div>
                    <div className="text-[9px] text-[#666666]">
                      {cl.contact.phone || ""}{cl.contact.email ? ` · ${cl.contact.email}` : ""}
                    </div>
                  </div>
                ))}
                {customer.siteContactLinks.length > 5 && (
                  <div className="text-[9px] text-[#666666]">
                    +{customer.siteContactLinks.length - 5} more
                  </div>
                )}
              </div>
            )}
          </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="lg:col-span-2 space-y-4">
              {/* Financials — Receivables + Cost/Margin (rolled up across family when bucket) */}
              {(() => {
                const invs = customer.invoices ?? [];
                const totalRevenue = invs.reduce((s, i) => s + Number(i.totalSell ?? i.totalGross), 0);
                const totalGross = invs.reduce((s, i) => s + Number(i.totalGross), 0);
                const totalPaid = invs.filter((i) => i.status === "PAID").reduce((s, i) => s + Number(i.totalGross), 0);
                const outstanding = totalGross - totalPaid;
                const overdue = invs
                  .filter((i) => i.status !== "PAID" && i.dueDate && new Date(i.dueDate) < new Date())
                  .reduce((s, i) => s + Number(i.totalGross), 0);
                const totalCost = supplierBillLines.reduce((s, l) => s + Number(l.lineTotal), 0);
                const margin = totalRevenue - totalCost;
                const marginPct = totalRevenue > 0 ? (margin / totalRevenue) * 100 : null;
                const label = isBucket ? "Financials — Group" : "Financials";
                return (
                  <div className="border border-[#333333] bg-[#1A1A1A] p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">{label}</div>
                      {isBucket && (
                        <Badge className="text-[8px] px-1 py-0 text-[#FFCC00] bg-[#FFCC00]/10">
                          {customer.subsidiaries.length} SUBS
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div>
                        <div className="text-[9px] text-[#666666] uppercase">Revenue</div>
                        <div className="text-lg tabular-nums text-[#E0E0E0]">£{totalRevenue.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-[#666666] uppercase">Cost</div>
                        <div className="text-lg tabular-nums text-[#E0E0E0]">£{totalCost.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-[#666666] uppercase">Margin</div>
                        <div className={`text-lg tabular-nums ${margin < 0 ? "text-[#FF3333]" : "text-[#00CC66]"}`}>
                          £{margin.toFixed(2)}
                          {marginPct !== null && (
                            <span className="text-[9px] text-[#888888] ml-1">({marginPct.toFixed(1)}%)</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 pt-3 border-t border-[#333333]">
                      <div>
                        <div className="text-[9px] text-[#666666] uppercase">Outstanding</div>
                        <div className="text-sm tabular-nums text-[#E0E0E0]">£{outstanding.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-[#666666] uppercase">Overdue</div>
                        <div className={`text-sm tabular-nums ${overdue > 0 ? "text-[#FF3333]" : "text-[#E0E0E0]"}`}>£{overdue.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-[#666666] uppercase">Invoices</div>
                        <div className="text-sm tabular-nums text-[#E0E0E0]">{invs.length}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Activity timeline */}
              {(() => {
                type Activity = { kind: "TICKET" | "PO" | "INVOICE"; date: Date; title: string; sub: string; href: string; badge: string; badgeClass: string; entity: string | null };
                const activity: Activity[] = [];
                const entityTagFor = (id: string | null | undefined) =>
                  isBucket && id && id !== customer.id ? (inheritSourceNames[id] ?? null) : null;
                for (const t of customer.ticketsAsPayer) {
                  activity.push({
                    kind: "TICKET",
                    date: new Date(t.createdAt),
                    title: t.title,
                    sub: `${t.ticketMode.replace(/_/g, " ")} · ${t.status}`,
                    href: `/tickets/${t.id}`,
                    badge: "TICKET",
                    badgeClass: "text-[#FF6600] bg-[#FF6600]/10",
                    entity: entityTagFor(t.sourceEntityId),
                  });
                }
                for (const p of customer.customerPOs) {
                  activity.push({
                    kind: "PO",
                    date: new Date(),
                    title: p.poNo,
                    sub: `${p.poType} · ${p.status}${p.totalValue != null ? ` · £${Number(p.totalValue).toFixed(2)}` : ""}`,
                    href: `/po-register`,
                    badge: "PO",
                    badgeClass: "text-[#3399FF] bg-[#3399FF]/10",
                    entity: entityTagFor(p.sourceEntityId),
                  });
                }
                for (const inv of customer.invoices ?? []) {
                  if (!inv.issuedAt) continue;
                  activity.push({
                    kind: "INVOICE",
                    date: new Date(inv.issuedAt),
                    title: inv.invoiceNo || "(draft)",
                    sub: `${inv.status} · £${Number(inv.totalGross).toFixed(2)}`,
                    href: `/invoices`,
                    badge: "INVOICE",
                    badgeClass: "text-[#00CC66] bg-[#00CC66]/10",
                    entity: entityTagFor(inv.sourceEntityId),
                  });
                }
                activity.sort((a, b) => b.date.getTime() - a.date.getTime());
                const top = activity.slice(0, 25);
                return (
                  <div className="border border-[#333333] bg-[#1A1A1A] p-4">
                    <div className="text-[10px] uppercase tracking-widest text-[#888888] font-bold mb-3">
                      Activity
                    </div>
                    {top.length === 0 ? (
                      <div className="text-xs text-[#666666]">No activity yet.</div>
                    ) : (
                      <div className="space-y-2">
                        {top.map((a, i) => (
                          <Link key={i} href={a.href} className="flex items-start gap-3 hover:bg-[#222222] -mx-2 px-2 py-1.5">
                            <div className="text-[9px] text-[#666666] tabular-nums w-16 shrink-0 mt-0.5">
                              {a.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                            </div>
                            <Badge className={`text-[8px] px-1 py-0 shrink-0 ${a.badgeClass}`}>{a.badge}</Badge>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-[#E0E0E0] truncate">{a.title}</div>
                              <div className="text-[9px] text-[#666666]">
                                {a.sub}
                                {a.entity && (
                                  <span className="ml-2 text-[#FFCC00]">↳ {a.entity}</span>
                                )}
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </TabsContent>

        {/* HIERARCHY */}
        <TabsContent value="hierarchy" className="mt-4 space-y-4">
          {/* Parent entity */}
          <div className="border border-[#333333] bg-[#1A1A1A] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] uppercase tracking-widest text-[#888888] flex items-center gap-2">
                <Network className="size-3.5" /> PARENT ENTITY
              </div>
              <Sheet open={setParentOpen} onOpenChange={setSetParentOpen}>
                <SheetTrigger render={<Button size="sm" variant="outline" className="bg-[#222222] border-[#333333] text-[#E0E0E0] text-xs h-7">{customer.parentEntity ? "Change" : "Set Parent"}</Button>} />
                <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
                  <SheetHeader><SheetTitle className="text-[#E0E0E0]">Set Parent Entity</SheetTitle></SheetHeader>
                  <div className="flex flex-col gap-4 px-4">
                    <div className="space-y-1.5">
                      <Label>Parent Customer</Label>
                      <select value={selectedParentId} onChange={(e) => setSelectedParentId(e.target.value)} className="w-full h-9 bg-[#222222] border border-[#333333] text-[#E0E0E0] text-sm px-3">
                        <option value="">None (top-level entity)</option>
                        {allCustomers.filter((c) => c.id !== customer.id).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <SheetFooter>
                      <Button onClick={handleSetParent} disabled={savingParent} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                        {savingParent ? "Saving..." : "Save"}
                      </Button>
                    </SheetFooter>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
            {customer.parentEntity ? (
              <Link href={`/customers/${customer.parentEntity.id}`}>
                <div className="flex items-center gap-3 p-3 border border-[#333333] bg-[#222222] hover:bg-[#2A2A2A] cursor-pointer">
                  <Users className="size-5 text-[#FF6600]" />
                  <div>
                    <div className="font-medium text-[#E0E0E0]">{customer.parentEntity.name}</div>
                    <div className="text-[9px] text-[#888888]">Parent Entity</div>
                  </div>
                </div>
              </Link>
            ) : (
              <div className="text-xs text-[#666666] italic">No parent entity set — this is a top-level customer.</div>
            )}
          </div>

          {/* Subsidiaries */}
          <div className="border border-[#333333] bg-[#1A1A1A] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] uppercase tracking-widest text-[#888888] flex items-center gap-2">
                <Building2 className="size-3.5" /> SUBSIDIARIES ({customer.subsidiaries.length})
              </div>
              <div className="flex gap-2">
                <Sheet open={addSubOpen} onOpenChange={setAddSubOpen}>
                  <SheetTrigger render={<Button size="sm" variant="outline" className="bg-[#222222] border-[#333333] text-[#E0E0E0] text-xs h-7"><Plus className="size-3.5 mr-1" />Link Existing</Button>} />
                  <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
                    <SheetHeader><SheetTitle className="text-[#E0E0E0]">Link Existing as Subsidiary</SheetTitle></SheetHeader>
                    <div className="flex flex-col gap-4 px-4">
                      <div className="space-y-1.5">
                        <Label>Customer</Label>
                        <select value={selectedSubId} onChange={(e) => setSelectedSubId(e.target.value)} className="w-full h-9 bg-[#222222] border border-[#333333] text-[#E0E0E0] text-sm px-3">
                          <option value="">Select customer...</option>
                          {allCustomers.filter((c) => c.id !== customer.id && !customer.subsidiaries.some((s) => s.id === c.id)).map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <SheetFooter>
                        <Button onClick={handleAddSubsidiary} disabled={savingSub || !selectedSubId} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                          {savingSub ? "Linking..." : "Link as Subsidiary"}
                        </Button>
                      </SheetFooter>
                    </div>
                  </SheetContent>
                </Sheet>
                <Sheet open={createSubOpen} onOpenChange={setCreateSubOpen}>
                  <SheetTrigger render={<Button size="sm" className="bg-[#FF6600] text-black hover:bg-[#FF9900] text-xs h-7"><Plus className="size-3.5 mr-1" />Create New</Button>} />
                  <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333] w-[480px] sm:max-w-[480px]">
                    <SheetHeader>
                      <SheetTitle className="text-[#E0E0E0]">Create Subsidiary of {customer.name}</SheetTitle>
                    </SheetHeader>
                    <div className="flex flex-col gap-3 px-4 overflow-y-auto">
                      <div className="text-[10px] text-[#888888] bg-[#222222] border border-[#333333] px-3 py-2">
                        Commercial defaults (payment terms, PO requirements, margin, mode) are
                        pre-filled from <strong className="text-[#FF6600]">{customer.name}</strong>.
                        Override anything that differs for this entity.
                      </div>

                      <div className="space-y-1.5">
                        <Label>Name *</Label>
                        <Input value={subName} onChange={(e) => setSubName(e.target.value)} required placeholder="Trading name" />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Company Number (UK)</Label>
                        <div className="flex gap-2">
                          <Input
                            value={subCompanyNumber}
                            onChange={(e) => setSubCompanyNumber(e.target.value)}
                            placeholder="e.g. 10611686"
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleSubCompaniesHouseLookup}
                            disabled={subLookingUp || !subCompanyNumber.trim()}
                            className="bg-[#222222] border-[#333333] text-[#E0E0E0]"
                          >
                            <Search className="size-3.5 mr-1" />
                            {subLookingUp ? "..." : "Lookup"}
                          </Button>
                        </div>
                        {subLookupError && <p className="text-[10px] text-[#FF3333]">{subLookupError}</p>}
                      </div>

                      <div className="space-y-1.5">
                        <Label>Legal Name</Label>
                        <Input value={subLegalName} onChange={(e) => setSubLegalName(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>VAT Number</Label>
                        <Input value={subVatNumber} onChange={(e) => setSubVatNumber(e.target.value)} placeholder="GB123456789" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Billing Address</Label>
                        <textarea
                          value={subBillingAddress}
                          onChange={(e) => setSubBillingAddress(e.target.value)}
                          rows={3}
                          className="w-full bg-[#222222] border border-[#333333] text-[#E0E0E0] text-sm px-3 py-2 font-mono"
                          placeholder="One line per address line"
                        />
                      </div>

                      <div className="border-t border-[#333333] pt-3 mt-1">
                        <div className="text-[10px] uppercase tracking-widest text-[#FF6600] font-bold mb-2">Inherited from parent</div>
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label>Payment Terms</Label>
                            <PaymentTermsSelect defaultValue={subPaymentTerms} onChange={setSubPaymentTerms} />
                          </div>
                          <div className="flex items-center gap-2">
                            <input type="checkbox" id="subPoRequired" checked={subPoRequired} onChange={(e) => setSubPoRequired(e.target.checked)} />
                            <Label htmlFor="subPoRequired">PO Required by default</Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <input type="checkbox" id="subIsBillingEntity" checked={subIsBillingEntity} onChange={(e) => setSubIsBillingEntity(e.target.checked)} />
                            <Label htmlFor="subIsBillingEntity" title="Untick only if this subsidiary is itself a label/grouping rather than a real billable entity.">Billing Entity</Label>
                          </div>
                          <div className="text-[9px] text-[#666666]">
                            Margin default and customer mode also inherit silently.
                          </div>
                        </div>
                      </div>

                      {subError && <p className="text-[11px] text-[#FF3333]">{subError}</p>}

                      <SheetFooter>
                        <Button
                          onClick={handleCreateSubsidiary}
                          disabled={creatingSub || !subName.trim()}
                          className="bg-[#FF6600] text-black hover:bg-[#FF9900]"
                        >
                          {creatingSub ? "Creating..." : "Create Subsidiary"}
                        </Button>
                      </SheetFooter>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </div>
            {customer.subsidiaries.length === 0 ? (
              <div className="text-xs text-[#666666] italic">No subsidiaries.</div>
            ) : (
              <div className="space-y-2">
                {customer.subsidiaries.map((sub) => (
                  <div key={sub.id} className="flex items-center justify-between border border-[#333333] bg-[#222222] p-3">
                    <Link href={`/customers/${sub.id}`} className="flex items-center gap-3 flex-1 hover:opacity-80">
                      <Building2 className="size-4 text-[#3399FF]" />
                      <div>
                        <div className="text-sm text-[#E0E0E0] font-medium">{sub.name}</div>
                        {sub.legalName && <div className="text-[9px] text-[#666666]">{sub.legalName}</div>}
                      </div>
                    </Link>
                    <div className="flex items-center gap-2">
                      {sub.isBillingEntity && <Badge className="text-[8px] px-1 py-0 text-[#3399FF] bg-[#3399FF]/10">BILLING</Badge>}
                      <button onClick={() => handleRemoveSubsidiary(sub.id)} className="text-[#FF3333] hover:text-[#FF6666] p-1" title="Remove subsidiary link">
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ALIASES */}
        <TabsContent value="aliases" className="mt-4 space-y-4">
          <div className="border border-[#333333] bg-[#1A1A1A] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] uppercase tracking-widest text-[#888888] flex items-center gap-2">
                <Tag className="size-3.5" /> CUSTOMER ALIASES
              </div>
            </div>
            <p className="text-[10px] text-[#666666] mb-3">
              Aliases allow the system to match different names/spellings to this customer during import and reconciliation.
            </p>

            {/* Add alias */}
            <div className="flex items-center gap-2 mb-4">
              <Input
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                placeholder="Add alias text..."
                className="h-8 text-xs bg-[#222222] border-[#333333] flex-1"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddAlias(); } }}
              />
              <Button size="sm" onClick={handleAddAlias} disabled={addingAlias || !newAlias.trim()} className="bg-[#FF6600] text-black hover:bg-[#FF9900] h-8">
                <Plus className="size-3.5 mr-1" />{addingAlias ? "Adding..." : "Add"}
              </Button>
            </div>

            {/* Alias list */}
            {customer.customerAliases.length === 0 ? (
              <div className="text-xs text-[#666666] italic">No aliases defined.</div>
            ) : (
              <div className="space-y-1">
                {customer.customerAliases.map((alias) => (
                  <div key={alias.id} className="flex items-center justify-between border border-[#333333] bg-[#222222] px-3 py-2">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-[#E0E0E0] bb-mono">{alias.aliasText}</span>
                      <Badge className={`text-[7px] px-1 py-0 ${alias.manualConfirmed ? "text-[#00CC66] bg-[#00CC66]/10" : "text-[#FF9900] bg-[#FF9900]/10"}`}>
                        {alias.manualConfirmed ? "CONFIRMED" : "AUTO"}
                      </Badge>
                      {alias.aliasSource && (
                        <Badge className="text-[7px] px-1 py-0 text-[#888888] bg-[#333333]">{alias.aliasSource.toUpperCase()}</Badge>
                      )}
                      {alias.confidenceScore != null && (
                        <span className="text-[9px] text-[#888888] bb-mono">{Number(alias.confidenceScore)}%</span>
                      )}
                    </div>
                    <button onClick={() => handleDeleteAlias(alias.id)} className="text-[#FF3333] hover:text-[#FF6666] p-1" title="Remove alias">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* SITES */}
        {!embedded && (
        <TabsContent value="sites" className="mt-4 space-y-3">
          <div className="flex justify-between items-center">
            <div className="text-[10px] uppercase tracking-widest text-[#888888]">LINKED SITES</div>
            <Sheet open={linkOpen} onOpenChange={setLinkOpen}>
              <SheetTrigger render={<Button size="sm" className="bg-[#FF6600] text-black hover:bg-[#FF9900]"><Plus className="size-4 mr-1" />Link Site</Button>} />
              <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
                <SheetHeader><SheetTitle className="text-[#E0E0E0]">Link Site to Customer</SheetTitle></SheetHeader>
                <form onSubmit={handleLinkSite} className="flex flex-col gap-4 px-4">
                  <div className="space-y-1.5">
                    <Label>Site</Label>
                    <select value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)} className="w-full h-9 bg-[#222222] border border-[#333333] text-[#E0E0E0] text-sm px-3">
                      <option value="">Select site...</option>
                      {allSites.map((s) => <option key={s.id} value={s.id}>{s.siteName}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5"><Label>Role</Label><Input name="role" defaultValue="Main Contractor" /></div>
                  <div className="flex items-center gap-2"><input type="checkbox" name="billingAllowed" id="billingAllowed" defaultChecked /><Label htmlFor="billingAllowed">Billing Allowed</Label></div>
                  <div className="flex items-center gap-2"><input type="checkbox" name="defaultBilling" id="defaultBilling" /><Label htmlFor="defaultBilling">Default Billing Customer</Label></div>
                  <SheetFooter><Button type="submit" disabled={linkSubmitting} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">{linkSubmitting ? "Linking..." : "Link Site"}</Button></SheetFooter>
                </form>
              </SheetContent>
            </Sheet>
          </div>
          {customer.siteCommercialLinks.length === 0 ? (
            <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center text-[#888888]">No sites linked yet.</div>
          ) : (
            <div className="space-y-2">
              {customer.siteCommercialLinks.map((link) => {
                const expanded = expandedSiteIds.has(link.site.id);
                const toggle = () => {
                  setExpandedSiteIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(link.site.id)) next.delete(link.site.id);
                    else next.add(link.site.id);
                    return next;
                  });
                };
                return (
                  <div key={link.id} className="border border-[#333333] bg-[#1A1A1A]">
                    <div className="p-4 hover:bg-[#222222] cursor-pointer flex items-center justify-between" onClick={toggle}>
                      <div className="flex items-center gap-3">
                        {expanded ? <ChevronDown className="size-4 text-[#888888]" /> : <ChevronRight className="size-4 text-[#888888]" />}
                        <Building2 className="size-5 text-[#FF6600]" />
                        <div>
                          <div className="font-medium text-[#E0E0E0]">{link.site.siteName}</div>
                          <div className="text-[10px] text-[#666666]">
                            {link.site.city && `${link.site.city} `}{link.site.postcode || ""}
                            {link.site.siteCode && ` · ${link.site.siteCode}`}
                          </div>
                          {link.site.aliases.length > 0 && (
                            <div className="flex gap-1 mt-0.5">
                              {link.site.aliases.map((a, i) => (
                                <span key={i} className="text-[8px] px-1 py-0 text-[#FF6600] bg-[#FF6600]/10 border border-[#FF6600]/20">{a}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="text-[9px] px-1.5 py-0.5 text-[#888888] bg-[#333333]">{link.role}</Badge>
                        {link.billingAllowed && <Badge className="text-[8px] px-1 py-0 text-[#00CC66] bg-[#00CC66]/10">BILLING</Badge>}
                        {link.defaultBillingCustomer && <Badge className="text-[8px] px-1 py-0 text-[#3399FF] bg-[#3399FF]/10">DEFAULT</Badge>}
                        <Link href={`/sites/${link.site.id}`} onClick={(e) => e.stopPropagation()} className="text-[10px] text-[#FF6600] hover:underline ml-2">
                          Open page →
                        </Link>
                      </div>
                    </div>
                    {expanded && (
                      <div className="border-t border-[#333333] p-4">
                        <SiteEmbedded siteId={link.site.id} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
        )}

        {/* TICKETS */}
        <TabsContent value="tickets" className="mt-4">
          {customer.ticketsAsPayer.length === 0 ? (
            <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center text-[#888888]">No tickets.</div>
          ) : (
            <div className="border border-[#333333] bg-[#1A1A1A]">
              {customer.ticketsAsPayer.map((t) => (
                <Link key={t.id} href={`/tickets/${t.id}`}>
                  <div className="border-b border-[#2A2A2A] px-3 py-2 hover:bg-[#222222] flex items-center justify-between">
                    <div>
                      <div className="text-xs text-[#E0E0E0]">{t.title}</div>
                      <div className="text-[9px] text-[#666666]">{new Date(t.createdAt).toLocaleDateString("en-GB")}</div>
                    </div>
                    <div className="flex gap-2">
                      <Badge className="text-[8px] px-1 py-0 text-[#888888] bg-[#333333]">{t.ticketMode.replace(/_/g, " ")}</Badge>
                      <Badge className="text-[8px] px-1 py-0 text-[#FF9900] bg-[#FF9900]/10">{t.status}</Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        {/* CONTACTS */}
        <TabsContent value="contacts" className="mt-4 space-y-3">
          <div className="flex justify-between items-center">
            <div className="text-[10px] uppercase tracking-widest text-[#888888]">CONTACTS</div>
            <Sheet open={addContactOpen} onOpenChange={setAddContactOpen}>
              <SheetTrigger render={<Button size="sm" className="bg-[#FF6600] text-black hover:bg-[#FF9900]"><Plus className="size-4 mr-1" />Add Contact</Button>} />
              <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
                <SheetHeader><SheetTitle className="text-[#E0E0E0]">Add Contact</SheetTitle></SheetHeader>
                <form onSubmit={handleAddContact} className="flex flex-col gap-4 px-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="contactName">Full Name *</Label>
                    <Input id="contactName" name="contactName" required placeholder="e.g. John Smith" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contactPhone">Phone</Label>
                    <Input id="contactPhone" name="contactPhone" placeholder="e.g. 07700 900123" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contactEmail">Email</Label>
                    <Input id="contactEmail" name="contactEmail" type="email" placeholder="e.g. john@example.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contactRole">Role</Label>
                    <Input id="contactRole" name="contactRole" placeholder="e.g. Site Manager, Buyer" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contactNotes">Notes</Label>
                    <Input id="contactNotes" name="contactNotes" placeholder="Any notes..." />
                  </div>
                  {customer.siteCommercialLinks.length === 0 && (
                    <p className="text-[9px] text-[#FF9900]">
                      No sites linked to this customer yet. Link a site first to fully associate contacts.
                    </p>
                  )}
                  <SheetFooter>
                    <Button type="submit" disabled={addingContact} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                      {addingContact ? "Creating..." : "Create Contact"}
                    </Button>
                  </SheetFooter>
                </form>
              </SheetContent>
            </Sheet>
          </div>
          {customer.siteContactLinks.length === 0 ? (
            <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center text-[#888888]">No contacts linked yet.</div>
          ) : (
            <div className="border border-[#333333] bg-[#1A1A1A]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customer.siteContactLinks.map((cl) => (
                    <TableRow key={cl.id} className="border-[#333333]">
                      <TableCell className="text-[#E0E0E0] font-medium">{cl.contact.fullName}</TableCell>
                      <TableCell className="text-[#888888] text-xs">{cl.contact.phone || "—"}</TableCell>
                      <TableCell className="text-[#888888] text-xs">{cl.contact.email || "—"}</TableCell>
                      <TableCell className="text-[#888888] text-xs">{cl.roleOnSite || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Supplier Bills Tab — every bill line landed on this customer (or family) */}
        <TabsContent value="bills" className="mt-4">
          <div className="border border-[#333333] bg-[#1A1A1A]">
            {supplierBillLines.length === 0 ? (
              <p className="text-sm text-[#888888] p-6">No supplier bill lines allocated to this customer yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Bill #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Ticket</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Line Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplierBillLines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-[#888888]">
                        {new Date(l.supplierBill.billDate).toLocaleDateString("en-GB")}
                      </TableCell>
                      <TableCell>{l.supplierBill.supplier.name}</TableCell>
                      <TableCell>
                        <a href={`/procurement?bill=${l.supplierBill.id}`} className="text-[#FF6600] hover:underline">
                          {l.supplierBill.billNo}
                        </a>
                      </TableCell>
                      <TableCell className="text-xs max-w-md truncate" title={l.description}>{l.description}</TableCell>
                      <TableCell className="text-xs">
                        {l.site ? (
                          <a href={`/sites/${l.site.id}`} className="text-[#FF6600] hover:underline">{l.site.siteName}</a>
                        ) : <span className="text-[#888888]">—</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {l.ticket ? (
                          <a href={`/tickets/${l.ticket.id}`} className="text-[#FF6600] hover:underline">#{l.ticket.ticketNo}</a>
                        ) : <span className="text-[#888888]">—</span>}
                      </TableCell>
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

        <TabsContent value="zoho" className="mt-4">
          <ZohoCustomerHistoryTab customerId={customer.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Renders a billing field showing the effective value with provenance:
 *   - own value     → plain
 *   - inherited     → value + "inherited from <ParentName>" badge
 *   - nothing set   → "—"
 */
function EffectiveValue({
  own,
  effective,
  sourceId,
  selfId,
  sourceNames,
}: {
  own: string | null;
  effective: string | null;
  sourceId: string | null;
  selfId: string;
  sourceNames: Record<string, string>;
}) {
  if (own !== null && own !== "") {
    return <span>{own}</span>;
  }
  if (effective === null || effective === "") {
    return <span className="text-[#666666]">—</span>;
  }
  const inheritedFrom = sourceId && sourceId !== selfId ? sourceNames[sourceId] ?? null : null;
  return (
    <span>
      {effective}
      {inheritedFrom && (
        <span className="ml-2 inline-block text-[8px] uppercase tracking-wider text-[#FFCC00] bg-[#FFCC00]/10 px-1 py-0.5 rounded">
          inherited from {inheritedFrom}
        </span>
      )}
    </span>
  );
}
