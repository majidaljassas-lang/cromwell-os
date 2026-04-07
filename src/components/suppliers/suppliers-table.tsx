"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

type SupplierData = {
  id: string;
  name: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

interface SuppliersTableProps {
  suppliers: SupplierData[];
}

export function SuppliersTable({ suppliers }: SuppliersTableProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = e.currentTarget;
    const fd = new FormData(form);
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name") as string,
          legalName: (fd.get("legalName") as string) || undefined,
          email: (fd.get("email") as string) || undefined,
          phone: (fd.get("phone") as string) || undefined,
          notes: (fd.get("notes") as string) || undefined,
        }),
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Suppliers</h1>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button size="sm" className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                <Plus className="size-4 mr-1" />
                Add Supplier
              </Button>
            }
          />
          <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
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
                <Input id="s-name" name="name" required placeholder="Supplier name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-legal">Legal Name</Label>
                <Input id="s-legal" name="legalName" placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-email">Email</Label>
                <Input id="s-email" name="email" type="email" placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-phone">Phone</Label>
                <Input id="s-phone" name="phone" placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-notes">Notes</Label>
                <Textarea id="s-notes" name="notes" placeholder="Optional" rows={3} />
              </div>
              <SheetFooter>
                <Button type="submit" disabled={submitting} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                  {submitting ? "Adding..." : "Add Supplier"}
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
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-[#888888]">
                  No suppliers yet. Add your first supplier.
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-[#888888]">
                    {s.legalName || "\u2014"}
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {s.email || "\u2014"}
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {s.phone || "\u2014"}
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
