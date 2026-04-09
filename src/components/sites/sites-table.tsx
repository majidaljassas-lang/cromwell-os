"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, MoreHorizontal, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

type SiteWithLinks = {
  id: string;
  siteName: string;
  siteCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  siteCommercialLinks: Array<{
    id: string;
    customer: { id: string; name: string };
  }>;
};

type CustomerOption = { id: string; name: string };

/** Auto-generate site code from site name.
 *  "83 Addison Road" -> "83-ADD"
 *  "St Georges Hospital" -> "STG"
 *  "2 Lexham Walk" -> "2-LEX"
 */
function generateSiteCode(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";

  const parts = trimmed.split(/\s+/);
  let prefix = "";
  let wordStart = 0;

  // If starts with a number, use it as prefix
  if (/^\d+$/.test(parts[0])) {
    prefix = parts[0];
    wordStart = 1;
  }

  // Find the first significant word (skip short common words)
  const skipWords = new Set(["the", "a", "an", "of", "at", "in", "on", "to", "for", "and"]);
  let significantWord = "";
  for (let i = wordStart; i < parts.length; i++) {
    if (!skipWords.has(parts[i].toLowerCase()) && parts[i].length > 0) {
      significantWord = parts[i];
      break;
    }
  }

  if (!significantWord && parts.length > wordStart) {
    significantWord = parts[wordStart] || "";
  }

  const wordCode = significantWord
    .replace(/[^a-zA-Z]/g, "")
    .substring(0, 3)
    .toUpperCase();

  if (prefix && wordCode) return `${prefix}-${wordCode}`;
  if (prefix) return prefix;
  return wordCode;
}

export function SitesTable({
  sites,
  customers,
}: {
  sites: SiteWithLinks[];
  customers: CustomerOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [siteName, setSiteName] = useState("");
  const [siteCode, setSiteCode] = useState("");
  const [siteCodeManual, setSiteCodeManual] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);

  // Auto-generate site code when name changes (unless manually edited)
  function handleSiteNameChange(value: string) {
    setSiteName(value);
    if (!siteCodeManual) {
      setSiteCode(generateSiteCode(value));
    }
  }

  function handleSiteCodeChange(value: string) {
    setSiteCode(value);
    setSiteCodeManual(value !== "" && value !== generateSiteCode(siteName));
  }

  // Filtered customers for searchable dropdown
  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers;
    const lower = customerSearch.toLowerCase();
    return customers.filter((c) => c.name.toLowerCase().includes(lower));
  }, [customers, customerSearch]);

  function selectCustomer(c: CustomerOption) {
    setSelectedCustomerId(c.id);
    setCustomerSearch(c.name);
    setCustomerDropdownOpen(false);
  }

  function clearCustomer() {
    setSelectedCustomerId("");
    setCustomerSearch("");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);

    const form = e.currentTarget;
    const formData = new FormData(form);

    const body = {
      siteName: siteName,
      siteCode: siteCode || undefined,
      addressLine1: (formData.get("addressLine1") as string) || undefined,
      addressLine2: (formData.get("addressLine2") as string) || undefined,
      city: (formData.get("city") as string) || undefined,
      postcode: (formData.get("postcode") as string) || undefined,
      country: (formData.get("country") as string) || undefined,
      notes: (formData.get("notes") as string) || undefined,
    };

    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const newSite = await res.json();

        // Create commercial link if customer selected
        if (selectedCustomerId && newSite.id) {
          await fetch(`/api/sites/${newSite.id}/commercial-links`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customerId: selectedCustomerId,
              role: "CLIENT",
              billingAllowed: true,
              defaultBillingCustomer: true,
            }),
          });
        }

        form.reset();
        setSiteName("");
        setSiteCode("");
        setSiteCodeManual(false);
        setSelectedCustomerId("");
        setCustomerSearch("");
        setOpen(false);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Get primary customer name for a site
  function getPrimaryCustomer(site: SiteWithLinks): string | null {
    if (site.siteCommercialLinks.length === 0) return null;
    return site.siteCommercialLinks[0].customer.name;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">
            Jobs / Sites
          </h1>
          <p className="text-xs text-[#666666] mt-1">
            Manage sites and their commercial relationships
          </p>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                <Plus className="size-4 mr-1" />
                Add Site
              </Button>
            }
          />
          <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
            <SheetHeader>
              <SheetTitle className="text-[#E0E0E0]">Add New Site</SheetTitle>
              <SheetDescription className="text-[#666666]">
                Create a new site record. Fill in the details below.
              </SheetDescription>
            </SheetHeader>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto">
              <div className="space-y-1.5">
                <Label htmlFor="siteName">Site Name *</Label>
                <Input
                  id="siteName"
                  name="siteName"
                  required
                  placeholder="e.g. 83 Addison Road"
                  value={siteName}
                  onChange={(e) => handleSiteNameChange(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="siteCode">Site Code (auto-generated)</Label>
                <Input
                  id="siteCode"
                  name="siteCode"
                  placeholder="e.g. 83-ADD"
                  value={siteCode}
                  onChange={(e) => handleSiteCodeChange(e.target.value)}
                  className="bb-mono"
                />
                {siteCode && (
                  <p className="text-[9px] text-[#666666]">
                    {siteCodeManual ? "Manually set" : "Auto-generated from name"}
                  </p>
                )}
              </div>

              {/* Customer link - searchable dropdown */}
              <div className="space-y-1.5">
                <Label>Link Customer (optional)</Label>
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#666666]" />
                    <Input
                      placeholder="Search customers..."
                      value={customerSearch}
                      onChange={(e) => {
                        setCustomerSearch(e.target.value);
                        setCustomerDropdownOpen(true);
                        if (!e.target.value) setSelectedCustomerId("");
                      }}
                      onFocus={() => setCustomerDropdownOpen(true)}
                      className="pl-8"
                    />
                  </div>
                  {selectedCustomerId && (
                    <button
                      type="button"
                      onClick={clearCustomer}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] hover:text-[#FF3333] text-xs"
                    >
                      x
                    </button>
                  )}
                  {customerDropdownOpen && !selectedCustomerId && filteredCustomers.length > 0 && (
                    <div className="absolute z-50 top-full mt-1 w-full max-h-40 overflow-y-auto bg-[#222222] border border-[#333333] shadow-lg">
                      {filteredCustomers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => selectCustomer(c)}
                          className="w-full text-left px-3 py-1.5 text-sm text-[#E0E0E0] hover:bg-[#333333] border-b border-[#2A2A2A] last:border-0"
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedCustomerId && (
                  <p className="text-[9px] text-[#00CC66]">
                    Will create CLIENT commercial link
                  </p>
                )}
              </div>

              {/* Lifecycle: Start date */}
              <div className="space-y-1.5">
                <Label htmlFor="startDate">Start Date (optional)</Label>
                <Input id="startDate" name="startDate" type="date" className="text-[#E0E0E0]" />
                <p className="text-[9px] text-[#666666]">
                  Auto-set on first order if left blank
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="addressLine1">Address Line 1</Label>
                <Input id="addressLine1" name="addressLine1" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="addressLine2">Address Line 2</Label>
                <Input id="addressLine2" name="addressLine2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" name="city" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="postcode">Postcode</Label>
                  <Input id="postcode" name="postcode" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="country">Country</Label>
                <Input id="country" name="country" defaultValue="UK" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" placeholder="Any additional notes..." />
              </div>
              <SheetFooter>
                <Button type="submit" disabled={submitting} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                  {submitting ? "Creating..." : "Create Site"}
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
              <TableHead>Site Name</TableHead>
              <TableHead>Site Code</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Postcode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Commercial Links</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sites.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-[#666666]">
                  No sites found. Add your first site to get started.
                </TableCell>
              </TableRow>
            ) : (
              sites.map((site) => (
                <TableRow key={site.id} className="cursor-pointer hover:bg-[#222222] border-[#333333]">
                  <TableCell>
                    <Link
                      href={`/sites/${site.id}`}
                      className="font-medium text-[#FF6600] hover:text-[#FF9900] hover:underline"
                    >
                      {site.siteName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-[#888888] bb-mono text-xs">
                    {site.siteCode || "—"}
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {site.city || "—"}
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {site.postcode || "—"}
                  </TableCell>
                  <TableCell>
                    <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${site.isActive ? "bg-[#00CC66]/10 text-[#00CC66]" : "bg-[#888888]/10 text-[#888888]"}`}>
                      {site.isActive ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell className="text-[#888888] text-xs">
                    {getPrimaryCustomer(site) || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums bb-mono text-[#E0E0E0]">
                    {site.siteCommercialLinks.length}
                  </TableCell>
                  <TableCell>
                    <Link href={`/sites/${site.id}`}>
                      <Button variant="ghost" size="icon-xs">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </Link>
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
