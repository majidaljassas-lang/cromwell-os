"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Plus,
  Truck,
  Package,
  CheckCircle2,
  XCircle,
  Trash2,
  Send,
  Pencil,
} from "lucide-react";
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
import {
  addStopAction,
  allocateBillAction,
  completeStopAction,
  deleteStopAction,
  deleteRunAction,
  dispatchRunAction,
  overrideStopShareAction,
  reorderStopAction,
  setSplitMethodAction,
  updateRunAction,
} from "@/app/(dashboard)/deliveries/actions";

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
  notes: string | null;
  bills: { id: string; billNo: string; billDate: string; totalCost: string; paymentStatus: string }[];
  stops: Stop[];
};

type Stop = {
  id: string;
  sequence: number;
  type: "COLLECT" | "DELIVER";
  status: "PENDING" | "ARRIVED" | "COMPLETED" | "FAILED" | "SKIPPED";
  addressSnapshot: string | null;
  signedByName: string | null;
  notes: string | null;
  costShare: string | null;
  costShareOverridden: boolean;
  arrivedAt: string | null;
  completedAt: string | null;
  ticket: {
    id: string;
    ticketNo: number;
    title: string;
    status: string;
    deliveryBillingMode: "ABSORBED" | "CHARGEABLE";
    site: { siteName: string; postcode: string | null } | null;
    payingCustomer: { name: string } | null;
    lines: {
      id: string;
      description: string;
      qty: string;
      unit: string;
      lineType: string;
      actualSaleTotal: string | null;
      suggestedSaleUnit: string | null;
      deliveryCostShare: string | null;
    }[];
  };
  site: { siteName: string; postcode: string | null } | null;
  supplier: { name: string } | null;
  podDocument: { id: string; podType: string; fileName: string | null } | null;
};

type OpenTicket = {
  id: string;
  ticketNo: number;
  title: string;
  status: string;
  site: { siteName: string; postcode: string | null } | null;
  payingCustomer: { name: string } | null;
};

type Supplier = { id: string; name: string };
type Bill = { id: string; billNo: string; billDate: string; totalCost: string };

const stopColours: Record<Stop["status"], string> = {
  PENDING: "bg-[#3A3A3A] text-[#CCCCCC]",
  ARRIVED: "bg-[#3A3A1A] text-[#FFE57F]",
  COMPLETED: "bg-[#1F4F2A] text-[#7FFFA1]",
  FAILED: "bg-[#4A1A1A] text-[#FF7F7F]",
  SKIPPED: "bg-[#3A1A3A] text-[#FF7FFF]",
};

const runStatusColours: Record<Run["status"], string> = {
  DRAFT: "bg-[#3A3A3A] text-[#CCCCCC]",
  DISPATCHED: "bg-[#FF6600] text-black",
  COMPLETED: "bg-[#1F4F2A] text-[#7FFFA1]",
  CANCELLED: "bg-[#4A1A1A] text-[#FF7F7F]",
};

export function RunDetailView({
  run,
  openTickets,
  suppliers,
  cfSuppliers,
  candidateBills,
}: {
  run: Run;
  openTickets: OpenTicket[];
  suppliers: Supplier[];
  cfSuppliers: Supplier[];
  candidateBills: Bill[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editDriverSource, setEditDriverSource] = useState<Run["driverSource"]>(run.driverSource);
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [stopType, setStopType] = useState<"COLLECT" | "DELIVER">("DELIVER");
  const [ticketSearch, setTicketSearch] = useState("");

  const isLocked = run.status === "COMPLETED" || run.status === "CANCELLED";
  const totalCostShares = run.stops.reduce(
    (acc, s) => acc + (s.costShare ? Number(s.costShare) : 0),
    0,
  );
  const matchedBills = run.bills.length > 0;
  const matchedTotal = run.bills.reduce((acc, b) => acc + Number(b.totalCost), 0);

  const filteredTickets = ticketSearch
    ? openTickets.filter((t) => {
        const q = ticketSearch.toLowerCase();
        return (
          String(t.ticketNo).includes(q) ||
          t.title.toLowerCase().includes(q) ||
          t.site?.siteName.toLowerCase().includes(q) ||
          t.payingCustomer?.name.toLowerCase().includes(q)
        );
      })
    : openTickets.slice(0, 30);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/deliveries" className="text-[#888888] hover:text-[#FF6600]">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-wide bb-mono text-[#FF6600]">
              RUN #{run.runNo}
            </h1>
            <p className="text-xs text-[#777777] bb-mono mt-1">
              {new Date(run.runDate).toLocaleDateString("en-GB", {
                weekday: "long",
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={runStatusColours[run.status]}>{run.status}</Badge>
          {run.status === "DRAFT" && run.stops.length > 0 && (
            <form action={dispatchRunAction}>
              <input type="hidden" name="runId" value={run.id} />
              <Button
                size="sm"
                type="submit"
                className="bg-[#FF6600] text-black hover:bg-[#FF8533]"
              >
                <Send className="h-4 w-4 mr-1" /> Dispatch
              </Button>
            </form>
          )}
          {!isLocked && (
            <Sheet open={editOpen} onOpenChange={setEditOpen}>
              <SheetTrigger
                render={
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-[#2A2A2A]"
                  >
                    <Pencil className="h-4 w-4 mr-1" /> Edit
                  </Button>
                }
              />
              <SheetContent
                side="right"
                className="bg-[#0D0D0D] border-l border-[#2A2A2A] w-[480px] sm:max-w-[480px]"
              >
                <SheetHeader>
                  <SheetTitle className="bb-mono text-[#FF6600]">
                    Edit Run #{run.runNo}
                  </SheetTitle>
                </SheetHeader>
                <form
                  action={async (fd) => {
                    await updateRunAction(fd);
                    setEditOpen(false);
                  }}
                  className="space-y-3 mt-4 px-4"
                >
                  <input type="hidden" name="runId" value={run.id} />
                  <div>
                    <Label className="text-xs bb-mono">Run date</Label>
                    <Input
                      type="date"
                      name="runDate"
                      defaultValue={run.runDate.slice(0, 10)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs bb-mono">Driver source</Label>
                    <select
                      name="driverSource"
                      value={editDriverSource}
                      onChange={(e) =>
                        setEditDriverSource(e.target.value as Run["driverSource"])
                      }
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
                      defaultValue={run.driverName ?? ""}
                      placeholder={editDriverSource === "IN_HOUSE" ? "Dad" : "CF driver name"}
                    />
                  </div>
                  {editDriverSource === "CROMWELL_FREIGHT" && (
                    <div>
                      <Label className="text-xs bb-mono">CF supplier</Label>
                      <select
                        name="cfSupplierId"
                        defaultValue={run.cfSupplier?.id ?? ""}
                        className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded px-2 py-1.5 text-sm"
                      >
                        <option value="">— select —</option>
                        {cfSuppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs bb-mono">Vehicle reg</Label>
                    <Input
                      name="vehicleReg"
                      defaultValue={run.vehicleReg ?? ""}
                      placeholder="e.g. AB12 CDE"
                    />
                  </div>
                  <div>
                    <Label className="text-xs bb-mono">Notes</Label>
                    <Textarea
                      name="notes"
                      rows={3}
                      defaultValue={run.notes ?? ""}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-[#FF6600] text-black hover:bg-[#FF8533]"
                  >
                    Save
                  </Button>
                </form>
              </SheetContent>
            </Sheet>
          )}
          <form
            action={deleteRunAction}
            onSubmit={(e) => {
              if (
                !confirm(
                  `Delete run #${run.runNo}? This removes the run and its ${run.stops.length} stop(s). Linked bills and logistics events stay (just unlinked).`,
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="runId" value={run.id} />
            <Button
              size="sm"
              type="submit"
              variant="ghost"
              className="text-[#888888] hover:text-[#FF7F7F] hover:bg-[#4A1A1A]/30"
              title="Delete this run"
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card className="bg-[#111111] border-[#2A2A2A]">
          <CardContent className="p-3">
            <div className="text-[10px] bb-mono text-[#666666]">DRIVER</div>
            <div className="text-sm bb-mono mt-1">
              {run.driverSource === "CROMWELL_FREIGHT" ? (
                <span className="text-[#FFB97F]">CF: {run.driverName || run.cfSupplier?.name || "—"}</span>
              ) : (
                <span className="text-[#7FBFFF]">{run.driverName || "Dad"}</span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[#111111] border-[#2A2A2A]">
          <CardContent className="p-3">
            <div className="text-[10px] bb-mono text-[#666666]">VEHICLE</div>
            <div className="text-sm bb-mono mt-1 text-[#CCCCCC]">{run.vehicleReg || "—"}</div>
          </CardContent>
        </Card>
        <Card className="bg-[#111111] border-[#2A2A2A]">
          <CardContent className="p-3">
            <div className="text-[10px] bb-mono text-[#666666]">SPLIT METHOD</div>
            <form action={setSplitMethodAction}>
              <input type="hidden" name="runId" value={run.id} />
              <select
                name="splitMethod"
                disabled={isLocked}
                defaultValue={run.splitMethod}
                onChange={(e) => e.target.form?.requestSubmit()}
                className="text-xs bg-transparent border-none p-0 mt-1 text-[#FF6600] bb-mono cursor-pointer"
              >
                <option value="EQUAL">Equal per drop</option>
                <option value="TICKET_VALUE">By ticket value</option>
                <option value="MANUAL">Manual</option>
              </select>
            </form>
          </CardContent>
        </Card>
        <Card className="bg-[#111111] border-[#2A2A2A]">
          <CardContent className="p-3">
            <div className="text-[10px] bb-mono text-[#666666]">COST</div>
            <div className="text-sm bb-mono mt-1">
              {matchedBills ? (
                <span className="text-[#7FFFA1]">£{matchedTotal.toFixed(2)} matched</span>
              ) : run.driverSource === "CROMWELL_FREIGHT" ? (
                <span className="text-[#FFE57F]">awaiting CF bill</span>
              ) : (
                <span className="text-[#666666]">in-house, no bill</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between mt-2">
        <h2 className="text-sm bb-mono tracking-wider text-[#888888]">STOPS</h2>
        {!isLocked && (
          <Sheet open={addOpen} onOpenChange={setAddOpen}>
            <SheetTrigger
              render={
                <Button size="sm" variant="outline" className="border-[#2A2A2A]">
                  <Plus className="h-4 w-4 mr-1" /> Add stop
                </Button>
              }
            />
            <SheetContent side="right" className="bg-[#0D0D0D] border-l border-[#2A2A2A] w-[480px] sm:max-w-[480px]">
              <SheetHeader>
                <SheetTitle className="bb-mono text-[#FF6600]">Add Stop</SheetTitle>
              </SheetHeader>
              <form action={addStopAction} className="space-y-3 mt-4 px-4">
                <input type="hidden" name="runId" value={run.id} />
                <div>
                  <Label className="text-xs bb-mono">Stop type</Label>
                  <select
                    name="type"
                    value={stopType}
                    onChange={(e) => setStopType(e.target.value as "COLLECT" | "DELIVER")}
                    className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded px-2 py-1.5 text-sm"
                  >
                    <option value="DELIVER">Deliver to site</option>
                    <option value="COLLECT">Collect from supplier</option>
                  </select>
                </div>

                <div>
                  <Label className="text-xs bb-mono">Ticket</Label>
                  <Input
                    placeholder="Search ticket # / title / site / customer"
                    value={ticketSearch}
                    onChange={(e) => setTicketSearch(e.target.value)}
                  />
                  <select
                    name="ticketId"
                    required
                    size={Math.min(filteredTickets.length || 1, 8)}
                    className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded px-2 py-1.5 text-xs mt-2"
                  >
                    {filteredTickets.map((t) => (
                      <option key={t.id} value={t.id}>
                        #{t.ticketNo} — {t.payingCustomer?.name ?? "?"} / {t.site?.siteName ?? "no site"} — {t.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label className="text-xs bb-mono">
                    {stopType === "COLLECT"
                      ? "Supplier (collection point)"
                      : "Collection point (optional)"}
                  </Label>
                  <select
                    name="supplierId"
                    required={stopType === "COLLECT"}
                    className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded px-2 py-1.5 text-sm"
                    defaultValue=""
                  >
                    <option value="">— {stopType === "COLLECT" ? "select" : "none"} —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {stopType === "DELIVER" && (
                    <p className="text-[10px] text-[#666666] mt-1">
                      Set this if the driver picks up from a supplier first, then drops at the site.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs bb-mono">From</Label>
                    <Input type="time" name="timeWindowStart" />
                  </div>
                  <div>
                    <Label className="text-xs bb-mono">To</Label>
                    <Input type="time" name="timeWindowEnd" />
                  </div>
                </div>

                <div>
                  <Label className="text-xs bb-mono">Notes for driver</Label>
                  <Textarea name="notes" rows={3} placeholder="e.g. ask for John on site, gate code 1234" />
                </div>

                <Button type="submit" className="w-full bg-[#FF6600] text-black hover:bg-[#FF8533]">
                  Add stop
                </Button>
              </form>
            </SheetContent>
          </Sheet>
        )}
      </div>

      <Card className="bg-[#111111] border-[#2A2A2A]">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b-[#2A2A2A]">
                <TableHead className="bb-mono text-[10px] w-[40px]">#</TableHead>
                <TableHead className="bb-mono text-[10px] w-[80px]">TYPE</TableHead>
                <TableHead className="bb-mono text-[10px]">TICKET / WHERE</TableHead>
                <TableHead className="bb-mono text-[10px]">ITEMS</TableHead>
                <TableHead className="bb-mono text-[10px] w-[100px]">COST SHARE</TableHead>
                <TableHead className="bb-mono text-[10px] w-[100px]">STATUS</TableHead>
                <TableHead className="bb-mono text-[10px] w-[140px]">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.stops.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-[#666666] py-8 bb-mono text-xs">
                    No stops yet — add one
                  </TableCell>
                </TableRow>
              )}
              {run.stops.map((stop, idx) => {
                const productLines = stop.ticket.lines.filter(
                  (l) => l.lineType !== "RETURN_ADJUSTMENT" && l.lineType !== "CASH_SALE",
                );
                return (
                  <TableRow key={stop.id} className="border-b-[#1A1A1A] align-top">
                    <TableCell className="bb-mono text-sm pt-3">
                      {!isLocked && (
                        <div className="flex flex-col gap-0.5">
                          <form action={reorderStopAction}>
                            <input type="hidden" name="stopId" value={stop.id} />
                            <input type="hidden" name="runId" value={run.id} />
                            <input type="hidden" name="direction" value="up" />
                            <button
                              type="submit"
                              disabled={idx === 0}
                              className="text-[#666666] hover:text-[#FF6600] disabled:opacity-20"
                            >
                              <ChevronUp className="h-3 w-3" />
                            </button>
                          </form>
                          <span className="text-center">{stop.sequence}</span>
                          <form action={reorderStopAction}>
                            <input type="hidden" name="stopId" value={stop.id} />
                            <input type="hidden" name="runId" value={run.id} />
                            <input type="hidden" name="direction" value="down" />
                            <button
                              type="submit"
                              disabled={idx === run.stops.length - 1}
                              className="text-[#666666] hover:text-[#FF6600] disabled:opacity-20"
                            >
                              <ChevronDown className="h-3 w-3" />
                            </button>
                          </form>
                        </div>
                      )}
                      {isLocked && stop.sequence}
                    </TableCell>
                    <TableCell className="pt-3">
                      {stop.type === "DELIVER" ? (
                        <Badge className="bg-[#1F2F4A] text-[#7FBFFF]">
                          <Package className="h-3 w-3 mr-1" /> DROP
                        </Badge>
                      ) : (
                        <Badge className="bg-[#3A2A1A] text-[#FFB97F]">
                          <Truck className="h-3 w-3 mr-1" /> PICK
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="pt-3">
                      <div className="text-xs bb-mono">
                        <Link href={`/tickets/${stop.ticket.id}`} className="text-[#FF6600] hover:underline">
                          #{stop.ticket.ticketNo}
                        </Link>
                        <span className="text-[#888888] mx-1">·</span>
                        <span className="text-[#CCCCCC]">{stop.ticket.payingCustomer?.name}</span>
                      </div>
                      <div className="text-[11px] text-[#888888] mt-0.5">
                        {stop.ticket.title}
                      </div>
                      <div className="text-[11px] text-[#666666] mt-1">
                        {stop.addressSnapshot ||
                          (stop.type === "DELIVER"
                            ? stop.site?.siteName
                            : stop.supplier?.name)}
                      </div>
                      {stop.type === "DELIVER" && stop.supplier?.name && (
                        <div className="text-[10px] text-[#FFB97F] mt-0.5">
                          ↑ collect from {stop.supplier.name}
                        </div>
                      )}
                      {stop.ticket.deliveryBillingMode === "CHARGEABLE" && (
                        <Badge className="mt-1 bg-[#1A3A2A] text-[#7FFFA1] text-[9px]">
                          CHARGEABLE
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="pt-3">
                      <div className="text-[11px] text-[#AAAAAA] space-y-0.5">
                        {productLines.slice(0, 3).map((l) => (
                          <div key={l.id} className="flex items-center gap-1">
                            <span className="text-[#666666]">{Number(l.qty).toFixed(0)} {l.unit}</span>
                            <span className="text-[#CCCCCC] truncate max-w-[200px]">{l.description}</span>
                            {l.deliveryCostShare && (
                              <span className="text-[#7FFFA1] ml-auto">+£{Number(l.deliveryCostShare).toFixed(2)}</span>
                            )}
                          </div>
                        ))}
                        {productLines.length > 3 && (
                          <div className="text-[#666666] text-[10px]">
                            + {productLines.length - 3} more
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="pt-3">
                      <form action={overrideStopShareAction} className="flex flex-col gap-1">
                        <input type="hidden" name="stopId" value={stop.id} />
                        <input type="hidden" name="runId" value={run.id} />
                        <Input
                          name="amount"
                          type="number"
                          step="0.01"
                          defaultValue={stop.costShare ?? ""}
                          placeholder="—"
                          className="h-7 text-xs"
                          disabled={isLocked}
                        />
                        {stop.costShareOverridden && (
                          <span className="text-[9px] text-[#FFE57F] bb-mono">OVERRIDDEN</span>
                        )}
                      </form>
                    </TableCell>
                    <TableCell className="pt-3">
                      <Badge className={stopColours[stop.status]}>{stop.status}</Badge>
                      {stop.podDocument && (
                        <div className="text-[9px] text-[#7FFFA1] bb-mono mt-1">
                          POD ✓ {stop.podDocument.podType}
                        </div>
                      )}
                      {stop.signedByName && (
                        <div className="text-[9px] text-[#888888] mt-0.5">
                          ✍ {stop.signedByName}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="pt-3">
                      <div className="flex flex-col gap-1">
                        {!isLocked && stop.status !== "COMPLETED" && stop.status !== "FAILED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-[#2A2A2A] h-7 text-[10px]"
                            onClick={() => setCompleteId(stop.id)}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
                          </Button>
                        )}
                        {!isLocked && run.status === "DRAFT" && (
                          <form action={deleteStopAction}>
                            <input type="hidden" name="stopId" value={stop.id} />
                            <input type="hidden" name="runId" value={run.id} />
                            <Button
                              size="sm"
                              variant="outline"
                              type="submit"
                              className="border-[#4A1A1A] text-[#FF7F7F] h-7 text-[10px] w-full"
                            >
                              <Trash2 className="h-3 w-3 mr-1" /> Remove
                            </Button>
                          </form>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Cost split summary */}
      {totalCostShares > 0 && (
        <Card className="bg-[#0F1A14] border-[#1F4F2A]">
          <CardContent className="p-3 text-xs bb-mono">
            <span className="text-[#7FFFA1]">£{totalCostShares.toFixed(2)}</span>
            <span className="text-[#666666]"> allocated across {run.stops.length} stops</span>
            {matchedBills && (
              <span className="text-[#666666]"> · matched £{matchedTotal.toFixed(2)} from {run.bills.length} bill{run.bills.length > 1 ? "s" : ""}</span>
            )}
          </CardContent>
        </Card>
      )}

      {/* CF bill matcher */}
      {run.driverSource === "CROMWELL_FREIGHT" &&
        candidateBills.length > 0 && (
          <Card className="bg-[#111111] border-[#2A2A2A]">
            <CardContent className="p-3 space-y-2">
              <div className="text-xs bb-mono text-[#888888]">
                MATCH CF BILL TO RUN
              </div>
              <form action={allocateBillAction} className="flex gap-2">
                <input type="hidden" name="runId" value={run.id} />
                <select
                  name="billId"
                  required
                  className="flex-1 bg-[#1A1A1A] border border-[#2A2A2A] rounded px-2 py-1.5 text-xs"
                  defaultValue=""
                >
                  <option value="">— select unmatched CF bill —</option>
                  {candidateBills.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.billNo} — {new Date(b.billDate).toLocaleDateString("en-GB")} — £{Number(b.totalCost).toFixed(2)}
                    </option>
                  ))}
                </select>
                <Button type="submit" className="bg-[#FF6600] text-black hover:bg-[#FF8533]">
                  Allocate
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

      {/* Already-matched bills */}
      {run.bills.length > 0 && (
        <Card className="bg-[#111111] border-[#2A2A2A]">
          <CardContent className="p-3">
            <div className="text-xs bb-mono text-[#888888] mb-2">
              MATCHED BILLS
            </div>
            <div className="space-y-1">
              {run.bills.map((b) => (
                <div key={b.id} className="flex items-center justify-between text-xs bb-mono">
                  <Link href={`/bills/${b.id}`} className="text-[#FF6600] hover:underline">
                    {b.billNo}
                  </Link>
                  <span className="text-[#666666]">
                    {new Date(b.billDate).toLocaleDateString("en-GB")}
                  </span>
                  <span className="text-[#CCCCCC]">£{Number(b.totalCost).toFixed(2)}</span>
                  <Badge
                    className={
                      b.paymentStatus === "PAID"
                        ? "bg-[#1F4F2A] text-[#7FFFA1]"
                        : "bg-[#3A3A1A] text-[#FFE57F]"
                    }
                  >
                    {b.paymentStatus}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Complete-stop dialog */}
      {completeId && (
        <CompleteStopDialog
          stop={run.stops.find((s) => s.id === completeId)!}
          runId={run.id}
          onClose={() => setCompleteId(null)}
        />
      )}
    </div>
  );
}

function CompleteStopDialog({
  stop,
  runId,
  onClose,
}: {
  stop: Stop;
  runId: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#111111] border border-[#2A2A2A] rounded p-4 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="bb-mono text-[#FF6600] mb-3">
          Complete stop #{stop.sequence}
        </h3>
        <div className="text-xs text-[#888888] bb-mono mb-3">
          {stop.type === "DELIVER" ? "Deliver to" : "Collect from"}:{" "}
          {stop.addressSnapshot}
        </div>
        <form
          action={async (fd) => {
            await completeStopAction(fd);
            onClose();
          }}
          className="space-y-3"
        >
          <input type="hidden" name="stopId" value={stop.id} />
          <input type="hidden" name="runId" value={runId} />
          {stop.type === "DELIVER" && (
            <div>
              <Label className="text-xs bb-mono">Signed by (POD)</Label>
              <Input name="signedByName" placeholder="Name of person on site" />
            </div>
          )}
          <div>
            <Label className="text-xs bb-mono">Notes</Label>
            <Textarea name="notes" rows={2} />
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              name="outcome"
              value="COMPLETED"
              className="flex-1 bg-[#1F4F2A] hover:bg-[#2A6E3A] text-[#7FFFA1]"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Done
            </Button>
            <Button
              type="submit"
              name="outcome"
              value="FAILED"
              variant="outline"
              className="flex-1 border-[#4A1A1A] text-[#FF7F7F]"
            >
              <XCircle className="h-4 w-4 mr-1" /> Failed
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="w-full text-[#666666]"
          >
            Cancel
          </Button>
        </form>
      </div>
    </div>
  );
}
