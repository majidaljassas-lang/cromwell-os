"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, MoreHorizontal } from "lucide-react";
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

type CustomerWithLinks = {
  id: string;
  name: string;
  legalName: string | null;
  billingAddress: string | null;
  vatNumber: string | null;
  paymentTerms: string | null;
  poRequiredDefault: boolean;
  isCashCustomer: boolean;
  notes: string | null;
  siteCommercialLinks: { id: string }[];
};

export function CustomersTable({
  customers,
}: {
  customers: CustomerWithLinks[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);

    const form = e.currentTarget;
    const formData = new FormData(form);

    const body = {
      name: formData.get("name") as string,
      legalName: (formData.get("legalName") as string) || undefined,
      billingAddress: (formData.get("billingAddress") as string) || undefined,
      vatNumber: (formData.get("vatNumber") as string) || undefined,
      paymentTerms: (formData.get("paymentTerms") as string) || undefined,
      poRequiredDefault: (formData.get("poRequiredDefault") as string) === "on",
      isCashCustomer: (formData.get("isCashCustomer") as string) === "on",
      notes: (formData.get("notes") as string) || undefined,
    };

    try {
      const res = await fetch("/api/customers", {
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
          <h1 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Customers</h1>
          <p className="text-xs text-[#666666] mt-1">
            Manage customer accounts and their site relationships
          </p>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                <Plus className="size-4 mr-1" />
                Add Customer
              </Button>
            }
          />
          <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
            <SheetHeader>
              <SheetTitle className="text-[#E0E0E0]">Add New Customer</SheetTitle>
              <SheetDescription className="text-[#666666]">
                Create a new customer record. Fill in the details below.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              <div className="space-y-1.5">
                <Label htmlFor="name">Customer Name *</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  placeholder="e.g. Balfour Beatty"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="legalName">Legal Name</Label>
                <Input
                  id="legalName"
                  name="legalName"
                  placeholder="Registered company name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="billingAddress">Billing Address</Label>
                <Textarea
                  id="billingAddress"
                  name="billingAddress"
                  placeholder="Full billing address"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vatNumber">VAT Number</Label>
                <Input
                  id="vatNumber"
                  name="vatNumber"
                  placeholder="e.g. GB123456789"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paymentTerms">Payment Terms</Label>
                <Input
                  id="paymentTerms"
                  name="paymentTerms"
                  placeholder="e.g. Net 30, Net 60"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="poRequiredDefault"
                  name="poRequiredDefault"
                  className="size-4 rounded border-input accent-primary"
                />
                <Label htmlFor="poRequiredDefault">PO Required by Default</Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isCashCustomer"
                  name="isCashCustomer"
                  className="size-4 rounded border-input accent-primary"
                />
                <Label htmlFor="isCashCustomer">Cash Customer</Label>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  placeholder="Any additional notes..."
                />
              </div>
              <SheetFooter>
                <Button type="submit" disabled={submitting} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                  {submitting ? "Creating..." : "Create Customer"}
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
              <TableHead>Name</TableHead>
              <TableHead>Legal Name</TableHead>
              <TableHead>Payment Terms</TableHead>
              <TableHead>PO Required</TableHead>
              <TableHead>Cash Customer</TableHead>
              <TableHead className="text-right">Sites</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-8 text-[#888888]"
                >
                  No customers found. Add your first customer to get started.
                </TableCell>
              </TableRow>
            ) : (
              customers.map((customer) => (
                <TableRow
                  key={customer.id}
                  className="cursor-pointer hover:bg-[#222222]"
                >
                  <TableCell>
                    <Link
                      href={`/customers/${customer.id}`}
                      className="font-medium text-[#FF6600] hover:text-[#FF9900] hover:underline"
                    >
                      {customer.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {customer.legalName || "—"}
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {customer.paymentTerms || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        customer.poRequiredDefault ? "default" : "outline"
                      }
                    >
                      {customer.poRequiredDefault ? "Yes" : "No"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={customer.isCashCustomer ? "secondary" : "outline"}
                    >
                      {customer.isCashCustomer ? "Yes" : "No"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums bb-mono text-[#E0E0E0]">
                    {customer.siteCommercialLinks.length}
                  </TableCell>
                  <TableCell>
                    <Link href={`/customers/${customer.id}`}>
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
