"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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

type Contact = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
};

export function ContactsTable({ contacts }: { contacts: Contact[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);

    const form = e.currentTarget;
    const formData = new FormData(form);

    const body = {
      fullName: formData.get("fullName") as string,
      phone: (formData.get("phone") as string) || undefined,
      email: (formData.get("email") as string) || undefined,
      notes: (formData.get("notes") as string) || undefined,
    };

    try {
      const res = await fetch("/api/contacts", {
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
          <h1 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Contacts</h1>
          <p className="text-xs text-[#666666] mt-1">
            Manage contacts across sites and customers
          </p>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                <Plus className="size-4 mr-1" />
                Add Contact
              </Button>
            }
          />
          <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333]">
            <SheetHeader>
              <SheetTitle className="text-[#E0E0E0]">Add New Contact</SheetTitle>
              <SheetDescription className="text-[#666666]">
                Create a new contact record.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full Name *</Label>
                <Input
                  id="fullName"
                  name="fullName"
                  required
                  placeholder="e.g. John Smith"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  name="phone"
                  placeholder="e.g. +44 7700 900000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="e.g. john@example.com"
                />
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
                  {submitting ? "Creating..." : "Create Contact"}
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
              <TableHead>Full Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center py-8 text-[#888888]"
                >
                  No contacts found. Add your first contact to get started.
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="font-medium">
                    {contact.fullName}
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {contact.phone || "\u2014"}
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {contact.email || "\u2014"}
                  </TableCell>
                  <TableCell>
                    <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${contact.isActive ? "bg-[#00CC66]/10 text-[#00CC66]" : "bg-[#888888]/10 text-[#888888]"}`}>
                      {contact.isActive ? "Active" : "Inactive"}
                    </span>
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
