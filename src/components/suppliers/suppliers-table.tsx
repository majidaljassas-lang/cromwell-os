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
    const fd = new FormData(e.currentTarget);
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
        e.currentTarget.reset();
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
        <h1 className="text-2xl font-semibold tracking-tight">Suppliers</h1>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button size="sm">
                <Plus className="size-4 mr-1" />
                Add Supplier
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Add Supplier</SheetTitle>
              <SheetDescription>
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
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Adding..." : "Add Supplier"}
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
              <TableHead>Name</TableHead>
              <TableHead>Legal Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  No suppliers yet. Add your first supplier.
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.legalName || "\u2014"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.email || "\u2014"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
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
