"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Truck,
  AlertCircle,
  CheckCircle2,
  Clock,
  PackageX,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Order = {
  id: string;
  poNo: string;
  supplierRef: string | null;
  issuedAt: string | null;
  status: string;
  siteRef: string | null;
  deliveryDateExpected: string | null;
  totalCostExpected: string;
  supplier: { id: string; name: string };
  ticket: {
    id: string;
    ticketNo: number;
    title: string;
    status: string;
    deliveryFailed: boolean;
    deliveredAt: string | null;
    site: { siteName: string; postcode: string | null } | null;
    payingCustomer: { name: string } | null;
    logisticsEvents: {
      id: string;
      stopStatus: string | null;
      timestamp: string;
      deliveredAt: string | null;
    }[];
  };
  lines: { id: string; description: string; qty: string; lineTotal: string }[];
};

type Bucket = "AWAITING" | "DUE_TODAY" | "OVERDUE" | "DELIVERED" | "FAILED";

function bucketise(o: Order): Bucket {
  if (o.ticket.deliveryFailed) return "FAILED";
  const latest = o.ticket.logisticsEvents[0];
  if (latest?.stopStatus === "DELIVERED") return "DELIVERED";
  if (latest?.stopStatus === "NOT_ARRIVED" || latest?.stopStatus === "BYPASSED")
    return "FAILED";
  if (!o.deliveryDateExpected) return "AWAITING";
  const expected = new Date(o.deliveryDateExpected);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expected);
  exp.setHours(0, 0, 0, 0);
  if (exp < today) return "OVERDUE";
  if (exp.getTime() === today.getTime()) return "DUE_TODAY";
  return "AWAITING";
}

const bucketMeta: Record<Bucket, { label: string; colour: string; icon: React.ComponentType<{ className?: string }> }> = {
  AWAITING: { label: "Awaiting", colour: "bg-[#3A3A3A] text-[#CCCCCC]", icon: Clock },
  DUE_TODAY: { label: "Due today", colour: "bg-[#FF6600] text-black", icon: Truck },
  OVERDUE: { label: "Overdue", colour: "bg-[#4A2A1A] text-[#FFB97F]", icon: AlertCircle },
  DELIVERED: { label: "Delivered", colour: "bg-[#1F4F2A] text-[#7FFFA1]", icon: CheckCircle2 },
  FAILED: { label: "Failed / bypassed", colour: "bg-[#4A1A1A] text-[#FF7F7F]", icon: PackageX },
};

export function InboundTrackerView({
  orders,
  filter,
}: {
  orders: Order[];
  filter?: string;
}) {
  const [search, setSearch] = useState("");

  const enriched = useMemo(
    () => orders.map((o) => ({ ...o, bucket: bucketise(o) })),
    [orders],
  );

  const buckets = useMemo(() => {
    const counts: Record<Bucket, number> = {
      AWAITING: 0,
      DUE_TODAY: 0,
      OVERDUE: 0,
      DELIVERED: 0,
      FAILED: 0,
    };
    for (const o of enriched) counts[o.bucket]++;
    return counts;
  }, [enriched]);

  const filtered = useMemo(() => {
    let rows = enriched;
    if (filter) {
      rows = rows.filter((o) => o.bucket === filter.toUpperCase());
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (o) =>
          o.poNo.toLowerCase().includes(q) ||
          o.supplier.name.toLowerCase().includes(q) ||
          o.ticket.payingCustomer?.name.toLowerCase().includes(q) ||
          o.ticket.site?.siteName.toLowerCase().includes(q) ||
          String(o.ticket.ticketNo).includes(q),
      );
    }
    return rows;
  }, [enriched, filter, search]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-wide bb-mono text-[#FF6600]">
          INBOUND ORDERS
        </h1>
        <p className="text-xs text-[#777777] bb-mono mt-1">
          Supplier POs we&apos;ve placed — tracked from issue to delivered
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {(Object.keys(bucketMeta) as Bucket[]).map((b) => {
          const m = bucketMeta[b];
          const Icon = m.icon;
          const isActive = (filter ?? "").toUpperCase() === b;
          const href = isActive
            ? "/orders/inbound"
            : `/orders/inbound?filter=${b}`;
          return (
            <Link key={b} href={href}>
              <Card
                className={`bg-[#111111] border ${
                  isActive ? "border-[#FF6600]" : "border-[#2A2A2A] hover:border-[#FF6600]"
                } transition-colors cursor-pointer`}
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 text-[10px] bb-mono text-[#666666]">
                    <Icon className="h-3 w-3" />
                    {m.label.toUpperCase()}
                  </div>
                  <div className="text-2xl bb-mono mt-1">
                    {buckets[b]}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Input
        placeholder="Search PO / supplier / customer / site / ticket #"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />

      <Card className="bg-[#111111] border-[#2A2A2A]">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b-[#2A2A2A]">
                <TableHead className="bb-mono text-[10px]">PO #</TableHead>
                <TableHead className="bb-mono text-[10px]">SUPPLIER</TableHead>
                <TableHead className="bb-mono text-[10px]">TICKET</TableHead>
                <TableHead className="bb-mono text-[10px]">SITE</TableHead>
                <TableHead className="bb-mono text-[10px]">EXPECTED</TableHead>
                <TableHead className="bb-mono text-[10px]">VALUE</TableHead>
                <TableHead className="bb-mono text-[10px]">STATUS</TableHead>
                <TableHead className="bb-mono text-[10px]">LATEST</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-[#666666] py-8 bb-mono text-xs">
                    No orders in this bucket
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((o) => {
                const bucket = bucketMeta[o.bucket];
                const total = o.lines.reduce(
                  (acc, l) => acc + Number(l.lineTotal),
                  0,
                );
                const latest = o.ticket.logisticsEvents[0];
                return (
                  <TableRow key={o.id} className="border-b-[#1A1A1A]">
                    <TableCell className="bb-mono text-xs">
                      <Link href={`/tickets/${o.ticket.id}`} className="text-[#FF6600] hover:underline">
                        {o.poNo}
                      </Link>
                    </TableCell>
                    <TableCell className="bb-mono text-xs">{o.supplier.name}</TableCell>
                    <TableCell className="bb-mono text-xs">
                      <Link href={`/tickets/${o.ticket.id}`} className="text-[#7FBFFF] hover:underline">
                        #{o.ticket.ticketNo}
                      </Link>
                      <span className="text-[#666666] ml-1">
                        {o.ticket.payingCustomer?.name}
                      </span>
                    </TableCell>
                    <TableCell className="bb-mono text-xs text-[#AAAAAA]">
                      {o.ticket.site?.siteName || "—"}
                    </TableCell>
                    <TableCell className="bb-mono text-xs">
                      {o.deliveryDateExpected
                        ? new Date(o.deliveryDateExpected).toLocaleDateString("en-GB")
                        : "—"}
                    </TableCell>
                    <TableCell className="bb-mono text-xs">
                      £{(Number(o.totalCostExpected) || total).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge className={bucket.colour}>{bucket.label}</Badge>
                    </TableCell>
                    <TableCell className="bb-mono text-[10px] text-[#888888]">
                      {latest
                        ? `${latest.stopStatus} · ${new Date(latest.timestamp).toLocaleDateString("en-GB")}`
                        : "no signal"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
