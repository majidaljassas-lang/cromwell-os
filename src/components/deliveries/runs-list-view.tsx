"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Truck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createRunAction } from "@/app/(dashboard)/deliveries/actions";

type Run = {
  id: string;
  runNo: number;
  runDate: string;
  driverSource: "IN_HOUSE" | "CROMWELL_FREIGHT";
  driverName: string | null;
  vehicleReg: string | null;
  status: "DRAFT" | "DISPATCHED" | "COMPLETED" | "CANCELLED";
  splitMethod: "EQUAL" | "TICKET_VALUE" | "MANUAL";
  cfSupplier: { id: string; name: string } | null;
  _count: { stops: number };
  stops: { id: string; status: string; type: string; sequence: number }[];
};

const statusColours: Record<Run["status"], string> = {
  DRAFT: "bg-[#3A3A3A] text-[#CCCCCC]",
  DISPATCHED: "bg-[#FF6600] text-black",
  COMPLETED: "bg-[#1F4F2A] text-[#7FFFA1]",
  CANCELLED: "bg-[#4A1A1A] text-[#FF7F7F]",
};

export function RunsListView({
  runs,
  cfSuppliers,
  filterStatus,
}: {
  runs: Run[];
  cfSuppliers: { id: string; name: string }[];
  filterStatus?: string;
}) {
  const [open, setOpen] = useState(false);
  const [driverSource, setDriverSource] = useState<"IN_HOUSE" | "CROMWELL_FREIGHT">("IN_HOUSE");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-wide bb-mono text-[#FF6600]">
            DELIVERY RUNS
          </h1>
          <p className="text-xs text-[#777777] bb-mono mt-1">
            Driver schedule + POD feed
          </p>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button size="sm" className="bg-[#FF6600] text-black hover:bg-[#FF8533]">
                <Plus className="h-4 w-4 mr-1" /> New Run
              </Button>
            }
          />
          <SheetContent side="right" className="bg-[#0D0D0D] border-l border-[#2A2A2A]">
            <SheetHeader>
              <SheetTitle className="bb-mono text-[#FF6600]">Create Run</SheetTitle>
            </SheetHeader>
            <form action={createRunAction} className="space-y-3 mt-4 px-4">
              <div>
                <Label className="text-xs bb-mono">Run date</Label>
                <Input
                  type="date"
                  name="runDate"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <div>
                <Label className="text-xs bb-mono">Driver source</Label>
                <select
                  name="driverSource"
                  value={driverSource}
                  onChange={(e) => setDriverSource(e.target.value as "IN_HOUSE" | "CROMWELL_FREIGHT")}
                  className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded px-2 py-1.5 text-sm"
                >
                  <option value="IN_HOUSE">In-house (Dad)</option>
                  <option value="CROMWELL_FREIGHT">Cromwell Freight</option>
                </select>
              </div>
              <div>
                <Label className="text-xs bb-mono">Driver name</Label>
                <Input
                  name="driverName"
                  placeholder={driverSource === "IN_HOUSE" ? "Dad" : "CF driver"}
                />
              </div>
              {driverSource === "CROMWELL_FREIGHT" && (
                <div>
                  <Label className="text-xs bb-mono">CF supplier (for cost match)</Label>
                  <select
                    name="cfSupplierId"
                    className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded px-2 py-1.5 text-sm"
                    defaultValue=""
                  >
                    <option value="">— select —</option>
                    {cfSuppliers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <Label className="text-xs bb-mono">Vehicle reg</Label>
                <Input name="vehicleReg" placeholder="AB12 CDE" />
              </div>
              <div>
                <Label className="text-xs bb-mono">Cost split method</Label>
                <select
                  name="splitMethod"
                  className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded px-2 py-1.5 text-sm"
                  defaultValue="EQUAL"
                >
                  <option value="EQUAL">Equal per drop</option>
                  <option value="TICKET_VALUE">Weighted by ticket sales value</option>
                  <option value="MANUAL">Manual (set per stop)</option>
                </select>
              </div>
              <div>
                <Label className="text-xs bb-mono">Notes</Label>
                <Textarea name="notes" rows={3} />
              </div>
              <Button type="submit" className="w-full bg-[#FF6600] text-black hover:bg-[#FF8533]">
                Create
              </Button>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      <div className="flex gap-2 text-xs bb-mono">
        {(["", "DRAFT", "DISPATCHED", "COMPLETED", "CANCELLED"] as const).map((s) => (
          <Link
            key={s}
            href={s ? `/deliveries?status=${s}` : "/deliveries"}
            className={`px-2 py-1 rounded border ${
              (filterStatus ?? "") === s
                ? "bg-[#FF6600] text-black border-[#FF6600]"
                : "border-[#2A2A2A] text-[#888888] hover:text-[#FF6600]"
            }`}
          >
            {s || "ALL"}
          </Link>
        ))}
      </div>

      <Card className="bg-[#111111] border-[#2A2A2A]">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b-[#2A2A2A]">
                <TableHead className="bb-mono text-[10px]">RUN #</TableHead>
                <TableHead className="bb-mono text-[10px]">DATE</TableHead>
                <TableHead className="bb-mono text-[10px]">DRIVER</TableHead>
                <TableHead className="bb-mono text-[10px]">SOURCE</TableHead>
                <TableHead className="bb-mono text-[10px]">VEHICLE</TableHead>
                <TableHead className="bb-mono text-[10px]">STOPS</TableHead>
                <TableHead className="bb-mono text-[10px]">PROGRESS</TableHead>
                <TableHead className="bb-mono text-[10px]">STATUS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-[#666666] py-8 bb-mono text-xs">
                    No runs yet — create one
                  </TableCell>
                </TableRow>
              )}
              {runs.map((run) => {
                const completed = run.stops.filter((s) => s.status === "COMPLETED").length;
                const failed = run.stops.filter((s) => s.status === "FAILED").length;
                return (
                  <TableRow
                    key={run.id}
                    className="border-b-[#1A1A1A] hover:bg-[#1A1A1A] cursor-pointer"
                  >
                    <TableCell className="bb-mono">
                      <Link href={`/deliveries/${run.id}`} className="text-[#FF6600] hover:underline">
                        #{run.runNo}
                      </Link>
                    </TableCell>
                    <TableCell className="bb-mono text-xs">
                      {new Date(run.runDate).toLocaleDateString("en-GB")}
                    </TableCell>
                    <TableCell className="bb-mono text-xs">
                      {run.driverName || "—"}
                    </TableCell>
                    <TableCell>
                      {run.driverSource === "IN_HOUSE" ? (
                        <Badge className="bg-[#1F2F4A] text-[#7FBFFF]">
                          <User className="h-3 w-3 mr-1" /> In-house
                        </Badge>
                      ) : (
                        <Badge className="bg-[#3A2A1A] text-[#FFB97F]">
                          <Truck className="h-3 w-3 mr-1" /> CF
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="bb-mono text-xs text-[#888888]">
                      {run.vehicleReg || "—"}
                    </TableCell>
                    <TableCell className="bb-mono text-xs">{run._count.stops}</TableCell>
                    <TableCell className="bb-mono text-xs">
                      {completed}/{run._count.stops}
                      {failed > 0 && (
                        <span className="text-[#FF7F7F] ml-1">({failed} failed)</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColours[run.status]}>{run.status}</Badge>
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
