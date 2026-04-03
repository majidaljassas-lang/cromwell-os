"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, MapPin, MoreHorizontal } from "lucide-react";
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
  siteCommercialLinks: { id: string }[];
};

export function SitesTable({ sites }: { sites: SiteWithLinks[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);

    const form = e.currentTarget;
    const formData = new FormData(form);

    const body = {
      siteName: formData.get("siteName") as string,
      siteCode: formData.get("siteCode") as string || undefined,
      addressLine1: formData.get("addressLine1") as string || undefined,
      addressLine2: formData.get("addressLine2") as string || undefined,
      city: formData.get("city") as string || undefined,
      postcode: formData.get("postcode") as string || undefined,
      country: formData.get("country") as string || undefined,
      notes: formData.get("notes") as string || undefined,
    };

    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        form.reset();
        setOpen(false);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
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
                <Input id="siteName" name="siteName" required placeholder="e.g. Heathrow Terminal 5" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="siteCode">Site Code</Label>
                <Input id="siteCode" name="siteCode" placeholder="e.g. HT5" />
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
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Commercial Links</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sites.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-[#666666]">
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
                  <TableCell className="text-[#888888]">
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
