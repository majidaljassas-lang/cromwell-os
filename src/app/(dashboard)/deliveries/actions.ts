"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { completeStop, dispatchRun } from "@/lib/logistics/run-completion";
import { allocateRunCost } from "@/lib/logistics/cost-allocator";

function pickDriverSource(v: FormDataEntryValue | null): "IN_HOUSE" | "CROMWELL_FREIGHT" {
  return v === "CROMWELL_FREIGHT" ? "CROMWELL_FREIGHT" : "IN_HOUSE";
}

function pickSplitMethod(v: FormDataEntryValue | null): "EQUAL" | "TICKET_VALUE" | "MANUAL" {
  if (v === "TICKET_VALUE") return "TICKET_VALUE";
  if (v === "MANUAL") return "MANUAL";
  return "EQUAL";
}

export async function createRunAction(formData: FormData) {
  const runDate = String(formData.get("runDate") || "");
  if (!runDate) throw new Error("runDate required");
  const driverSource = pickDriverSource(formData.get("driverSource"));
  const driverName = String(formData.get("driverName") || "") || null;
  const cfSupplierId = String(formData.get("cfSupplierId") || "") || null;
  const vehicleReg = String(formData.get("vehicleReg") || "") || null;
  const splitMethod = pickSplitMethod(formData.get("splitMethod"));
  const notes = String(formData.get("notes") || "") || null;

  const run = await prisma.deliveryRun.create({
    data: {
      runDate: new Date(runDate),
      driverSource,
      driverName,
      cfSupplierId: driverSource === "CROMWELL_FREIGHT" ? cfSupplierId : null,
      vehicleReg,
      splitMethod,
      notes,
    },
  });
  revalidatePath("/deliveries");
  redirect(`/deliveries/${run.id}`);
}

export async function addStopAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  const type = String(formData.get("type") || "DELIVER") as "COLLECT" | "DELIVER";
  const ticketId = String(formData.get("ticketId") || "");
  const supplierId = String(formData.get("supplierId") || "") || null;
  const notes = String(formData.get("notes") || "") || null;
  const timeWindowStart = String(formData.get("timeWindowStart") || "") || null;
  const timeWindowEnd = String(formData.get("timeWindowEnd") || "") || null;

  if (!runId || !ticketId) throw new Error("runId + ticketId required");

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { site: true },
  });
  if (!ticket) throw new Error("ticket not found");

  let addressSnapshot: string | null = null;
  if (type === "DELIVER" && ticket.site) {
    addressSnapshot = [
      ticket.site.siteName,
      ticket.site.addressLine1,
      ticket.site.addressLine2,
      ticket.site.city,
      ticket.site.postcode,
    ]
      .filter(Boolean)
      .join(", ");
  }
  if (type === "COLLECT" && supplierId) {
    const sup = await prisma.supplier.findUnique({ where: { id: supplierId } });
    addressSnapshot = sup?.name ?? null;
  }

  const last = await prisma.deliveryRunStop.findFirst({
    where: { runId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const sequence = (last?.sequence ?? 0) + 1;

  await prisma.deliveryRunStop.create({
    data: {
      runId,
      sequence,
      type,
      ticketId,
      siteId: type === "DELIVER" ? ticket.siteId : null,
      // Allow a collection point on DELIVER stops too (driver picks up
      // from supplier first, then drops at the site).
      supplierId: supplierId || null,
      addressSnapshot,
      timeWindowStart: timeWindowStart ? new Date(timeWindowStart) : null,
      timeWindowEnd: timeWindowEnd ? new Date(timeWindowEnd) : null,
      notes,
    },
  });
  revalidatePath(`/deliveries/${runId}`);
}

export async function dispatchRunAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  if (!runId) throw new Error("runId required");
  await dispatchRun(runId);
  revalidatePath(`/deliveries/${runId}`);
}

export async function completeStopAction(formData: FormData) {
  const stopId = String(formData.get("stopId") || "");
  const runId = String(formData.get("runId") || "");
  const outcome = (String(formData.get("outcome") || "COMPLETED") === "FAILED"
    ? "FAILED"
    : "COMPLETED") as "COMPLETED" | "FAILED";
  const signedByName = String(formData.get("signedByName") || "") || undefined;
  const notes = String(formData.get("notes") || "") || undefined;

  if (!stopId) throw new Error("stopId required");

  await completeStop({ stopId, outcome, signedByName, notes });
  revalidatePath(`/deliveries/${runId}`);
}

export async function reorderStopAction(formData: FormData) {
  const stopId = String(formData.get("stopId") || "");
  const runId = String(formData.get("runId") || "");
  const direction = String(formData.get("direction") || "");
  if (!stopId || !runId) throw new Error("stopId + runId required");

  const stops = await prisma.deliveryRunStop.findMany({
    where: { runId },
    orderBy: { sequence: "asc" },
    select: { id: true, sequence: true },
  });
  const idx = stops.findIndex((s) => s.id === stopId);
  if (idx === -1) return;
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= stops.length) return;

  const a = stops[idx];
  const b = stops[swapWith];
  // swap via temp value to dodge the (runId,sequence) unique constraint
  await prisma.$transaction([
    prisma.deliveryRunStop.update({
      where: { id: a.id },
      data: { sequence: -1 },
    }),
    prisma.deliveryRunStop.update({
      where: { id: b.id },
      data: { sequence: a.sequence },
    }),
    prisma.deliveryRunStop.update({
      where: { id: a.id },
      data: { sequence: b.sequence },
    }),
  ]);
  revalidatePath(`/deliveries/${runId}`);
}

export async function updateRunAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  if (!runId) throw new Error("runId required");

  const run = await prisma.deliveryRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  if (!run) throw new Error("run not found");
  if (run.status === "COMPLETED" || run.status === "CANCELLED") {
    throw new Error("cannot edit a completed or cancelled run");
  }

  const runDate = String(formData.get("runDate") || "");
  const driverSource = pickDriverSource(formData.get("driverSource"));
  const driverName = String(formData.get("driverName") || "") || null;
  const cfSupplierIdRaw = String(formData.get("cfSupplierId") || "") || null;
  const vehicleReg = String(formData.get("vehicleReg") || "") || null;

  await prisma.deliveryRun.update({
    where: { id: runId },
    data: {
      runDate: runDate ? new Date(runDate) : undefined,
      driverSource,
      driverName,
      cfSupplierId: driverSource === "CROMWELL_FREIGHT" ? cfSupplierIdRaw : null,
      vehicleReg,
      // Only write notes if the form actually included a notes field — otherwise
      // editing from a form that omits notes would wipe existing notes.
      notes: formData.has("notes")
        ? String(formData.get("notes") || "") || null
        : undefined,
    },
  });
  revalidatePath(`/deliveries/${runId}`);
  revalidatePath("/deliveries");
}

export async function setSplitMethodAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  const splitMethod = pickSplitMethod(formData.get("splitMethod"));
  if (!runId) throw new Error("runId required");
  await prisma.deliveryRun.update({
    where: { id: runId },
    data: { splitMethod },
  });
  revalidatePath(`/deliveries/${runId}`);
}

export async function overrideStopShareAction(formData: FormData) {
  const stopId = String(formData.get("stopId") || "");
  const runId = String(formData.get("runId") || "");
  const amountStr = String(formData.get("amount") || "");
  if (!stopId) throw new Error("stopId required");
  const amount = amountStr ? Number(amountStr) : null;
  await prisma.deliveryRunStop.update({
    where: { id: stopId },
    data: {
      costShare: amount === null ? null : (amount as unknown as never),
      costShareOverridden: amount !== null,
    },
  });
  revalidatePath(`/deliveries/${runId}`);
}

export async function allocateBillAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  const billId = String(formData.get("billId") || "");
  if (!runId || !billId) throw new Error("runId + billId required");
  await allocateRunCost(runId, billId);
  revalidatePath(`/deliveries/${runId}`);
}

export async function deleteStopAction(formData: FormData) {
  const stopId = String(formData.get("stopId") || "");
  const runId = String(formData.get("runId") || "");
  if (!stopId) throw new Error("stopId required");
  await prisma.deliveryRunStop.delete({ where: { id: stopId } });
  revalidatePath(`/deliveries/${runId}`);
}

export async function deleteRunAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  if (!runId) throw new Error("runId required");

  const run = await prisma.deliveryRun.findUnique({
    where: { id: runId },
    select: { id: true, runNo: true, status: true },
  });
  if (!run) throw new Error("run not found");

  await prisma.$transaction(async (tx) => {
    // 1. Detach any supplier bills linked to this run (preserve the bills).
    await tx.supplierBill.updateMany({
      where: { deliveryRunId: runId },
      data: { deliveryRunId: null },
    });

    // 2. For every stop on this run, unlink any LogisticsEvents (preserve them).
    const stops = await tx.deliveryRunStop.findMany({
      where: { runId },
      select: { id: true },
    });
    if (stops.length > 0) {
      const stopIds = stops.map((s) => s.id);
      await tx.logisticsEvent.updateMany({
        where: { runStopId: { in: stopIds } },
        data: { runStopId: null },
      });
      await tx.deliveryRunStop.deleteMany({ where: { runId } });
    }

    // 3. Delete the run itself.
    await tx.deliveryRun.delete({ where: { id: runId } });
  });

  revalidatePath("/deliveries");
  redirect("/deliveries");
}
