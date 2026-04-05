/**
 * Order Grouping Engine
 *
 * Clusters related classified messages into OrderGroups.
 *
 * Grouping logic:
 * 1. Same sender + same product family + within time window = same group
 * 2. CONFIRMATION messages attach to the most recent preceding order from same sender
 * 3. ADDITION messages attach to the most recent active group for that sender/site
 * 4. SUBSTITUTION creates a linked pair (OUT from existing group, IN as new or same group)
 * 5. Different sender = new group unless explicitly referencing another
 *
 * Flags uncertain groupings for manual review.
 */

import type { ClassifiedMessage, ExtractedProductLine } from "./order-classifier";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProposedOrderGroup {
  groupKey: string;
  label: string;
  sender: string;
  events: ProposedOrderEvent[];
  totalOrderedQty: number;
  products: string[];  // unique canonical product codes
  firstTimestamp: string;
  lastTimestamp: string;
  confidence: number;
  uncertainReasons: string[];
  isUncertain: boolean;
  sourceMessageIds: string[];
}

export interface ProposedOrderEvent {
  messageId: string;
  sourceId: string;
  sender: string;
  timestamp: string;
  rawText: string;
  eventType: string;
  confidence: number;
  reasons: string[];
  productLines: ExtractedProductLine[];
}

// ─── Configuration ──────────────────────────────────────────────────────────

/** Maximum time gap (hours) between messages to consider them part of the same order group */
const TIME_WINDOW_HOURS = 48;

/** Maximum time gap (hours) for a CONFIRMATION to attach to a preceding order */
const CONFIRMATION_WINDOW_HOURS = 72;

// ─── Core Grouper ───────────────────────────────────────────────────────────

export function groupOrderEvents(
  classifiedMessages: ClassifiedMessage[]
): ProposedOrderGroup[] {
  // Filter to only order-relevant messages, sorted by time
  const relevant = classifiedMessages
    .filter((m) => m.isOrderRelevant)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (relevant.length === 0) return [];

  const groups: ProposedOrderGroup[] = [];
  const messageToGroup = new Map<string, number>(); // messageId → group index

  for (const msg of relevant) {
    const event: ProposedOrderEvent = {
      messageId: msg.messageId,
      sourceId: msg.sourceId,
      sender: msg.sender,
      timestamp: msg.timestamp,
      rawText: msg.rawText,
      eventType: msg.eventType,
      confidence: msg.confidence,
      reasons: msg.reasons,
      productLines: msg.productLines,
    };

    switch (msg.eventType) {
      case "INITIAL_ORDER":
        handleInitialOrder(groups, event, msg, messageToGroup);
        break;

      case "ADDITION":
        handleAddition(groups, event, msg, messageToGroup);
        break;

      case "CONFIRMATION":
        handleConfirmation(groups, event, msg, messageToGroup);
        break;

      case "REDUCTION":
      case "CANCELLATION":
        handleReductionOrCancel(groups, event, msg, messageToGroup);
        break;

      case "SUBSTITUTION_IN":
      case "SUBSTITUTION_OUT":
        handleSubstitution(groups, event, msg, messageToGroup);
        break;

      case "QUERY_ONLY":
        // Queries don't create groups but we record them if they have product context
        if (msg.hasProductLines) {
          handleQueryWithProducts(groups, event, msg, messageToGroup);
        }
        break;
    }
  }

  // Calculate totals and finalize
  for (const group of groups) {
    recalculateGroup(group);
  }

  return groups;
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

function handleInitialOrder(
  groups: ProposedOrderGroup[],
  event: ProposedOrderEvent,
  msg: ClassifiedMessage,
  messageToGroup: Map<string, number>
) {
  // Check if there's a recent group from the same sender with overlapping products
  const existingIdx = findRecentGroupBySender(
    groups, msg.sender, msg.timestamp, TIME_WINDOW_HOURS, msg.productLines
  );

  if (existingIdx !== null) {
    // Merge into existing group, but flag as uncertain
    groups[existingIdx].events.push(event);
    groups[existingIdx].sourceMessageIds.push(msg.messageId);
    groups[existingIdx].uncertainReasons.push(
      `Merged with existing order from same sender within ${TIME_WINDOW_HOURS}h — verify not a separate order`
    );
    groups[existingIdx].isUncertain = true;
    messageToGroup.set(msg.messageId, existingIdx);
  } else {
    // New group
    const products = msg.productLines
      .map((pl) => pl.productCode)
      .filter((c): c is string => c !== null);

    const group: ProposedOrderGroup = {
      groupKey: `OG-${groups.length + 1}`,
      label: buildGroupLabel(msg.sender, msg.timestamp, products),
      sender: msg.sender,
      events: [event],
      totalOrderedQty: 0,
      products: [...new Set(products)],
      firstTimestamp: msg.timestamp,
      lastTimestamp: msg.timestamp,
      confidence: msg.confidence,
      uncertainReasons: [],
      isUncertain: msg.confidence < 60,
      sourceMessageIds: [msg.messageId],
    };

    if (msg.confidence < 60) {
      group.uncertainReasons.push(`Low classifier confidence: ${msg.confidence}%`);
    }

    messageToGroup.set(msg.messageId, groups.length);
    groups.push(group);
  }
}

function handleAddition(
  groups: ProposedOrderGroup[],
  event: ProposedOrderEvent,
  msg: ClassifiedMessage,
  messageToGroup: Map<string, number>
) {
  // Find the most recent group from the same sender
  const existingIdx = findRecentGroupBySender(
    groups, msg.sender, msg.timestamp, TIME_WINDOW_HOURS * 2, null
  );

  if (existingIdx !== null) {
    groups[existingIdx].events.push(event);
    groups[existingIdx].sourceMessageIds.push(msg.messageId);
    messageToGroup.set(msg.messageId, existingIdx);

    // Add new product codes
    for (const pl of msg.productLines) {
      if (pl.productCode && !groups[existingIdx].products.includes(pl.productCode)) {
        groups[existingIdx].products.push(pl.productCode);
      }
    }
  } else {
    // No recent group found — create new but flag
    handleInitialOrder(groups, event, msg, messageToGroup);
    const gIdx = groups.length - 1;
    groups[gIdx].uncertainReasons.push(
      "Classified as ADDITION but no preceding order group found — treated as new order"
    );
    groups[gIdx].isUncertain = true;
  }
}

function handleConfirmation(
  groups: ProposedOrderGroup[],
  event: ProposedOrderEvent,
  msg: ClassifiedMessage,
  messageToGroup: Map<string, number>
) {
  // Attach to the most recent preceding group from same sender
  const existingIdx = findRecentGroupBySender(
    groups, msg.sender, msg.timestamp, CONFIRMATION_WINDOW_HOURS, null
  );

  if (existingIdx !== null) {
    groups[existingIdx].events.push(event);
    groups[existingIdx].sourceMessageIds.push(msg.messageId);
    messageToGroup.set(msg.messageId, existingIdx);
  } else if (msg.hasProductLines) {
    // Confirmation with product lines but no preceding order — likely the order itself
    event.eventType = "INITIAL_ORDER";
    handleInitialOrder(groups, event, msg, messageToGroup);
    const gIdx = groups.length - 1;
    groups[gIdx].uncertainReasons.push(
      "Classified as CONFIRMATION but has product lines and no preceding order — reclassified as INITIAL_ORDER"
    );
    groups[gIdx].isUncertain = true;
  }
  // Otherwise ignore — confirmation without context
}

function handleReductionOrCancel(
  groups: ProposedOrderGroup[],
  event: ProposedOrderEvent,
  msg: ClassifiedMessage,
  messageToGroup: Map<string, number>
) {
  // Find an existing group with overlapping products
  const existingIdx = findRecentGroupBySender(
    groups, msg.sender, msg.timestamp, TIME_WINDOW_HOURS * 4, msg.productLines
  );

  if (existingIdx !== null) {
    groups[existingIdx].events.push(event);
    groups[existingIdx].sourceMessageIds.push(msg.messageId);
    messageToGroup.set(msg.messageId, existingIdx);
  } else {
    // Reduction/cancel with no matching group — flag for review
    handleInitialOrder(groups, event, msg, messageToGroup);
    const gIdx = groups.length - 1;
    groups[gIdx].uncertainReasons.push(
      `${msg.eventType} with no matching order group found — needs manual review`
    );
    groups[gIdx].isUncertain = true;
  }
}

function handleSubstitution(
  groups: ProposedOrderGroup[],
  event: ProposedOrderEvent,
  msg: ClassifiedMessage,
  messageToGroup: Map<string, number>
) {
  // Substitutions always flag for review
  const existingIdx = findRecentGroupBySender(
    groups, msg.sender, msg.timestamp, TIME_WINDOW_HOURS * 2, null
  );

  if (existingIdx !== null) {
    groups[existingIdx].events.push(event);
    groups[existingIdx].sourceMessageIds.push(msg.messageId);
    groups[existingIdx].uncertainReasons.push(
      "Substitution event detected — verify product swap is correct"
    );
    groups[existingIdx].isUncertain = true;
    messageToGroup.set(msg.messageId, existingIdx);
  } else {
    handleInitialOrder(groups, event, msg, messageToGroup);
    const gIdx = groups.length - 1;
    groups[gIdx].uncertainReasons.push("Substitution with no matching order group");
    groups[gIdx].isUncertain = true;
  }
}

function handleQueryWithProducts(
  groups: ProposedOrderGroup[],
  event: ProposedOrderEvent,
  msg: ClassifiedMessage,
  messageToGroup: Map<string, number>
) {
  // Record as a group but flagged — queries may convert to orders
  const products = msg.productLines
    .map((pl) => pl.productCode)
    .filter((c): c is string => c !== null);

  const group: ProposedOrderGroup = {
    groupKey: `OG-${groups.length + 1}`,
    label: `Query: ${msg.sender} ${new Date(msg.timestamp).toLocaleDateString("en-GB")}`,
    sender: msg.sender,
    events: [event],
    totalOrderedQty: 0,
    products: [...new Set(products)],
    firstTimestamp: msg.timestamp,
    lastTimestamp: msg.timestamp,
    confidence: 30,
    uncertainReasons: ["Query only — not a confirmed order"],
    isUncertain: true,
    sourceMessageIds: [msg.messageId],
  };

  messageToGroup.set(msg.messageId, groups.length);
  groups.push(group);
}

// ─── Group Searching ────────────────────────────────────────────────────────

function findRecentGroupBySender(
  groups: ProposedOrderGroup[],
  sender: string,
  timestamp: string,
  maxHours: number,
  productLines: ExtractedProductLine[] | null
): number | null {
  const msgTime = new Date(timestamp).getTime();
  let bestIdx: number | null = null;
  let bestScore = 0;

  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];

    // Must be from same sender
    if (group.sender !== sender) continue;

    // Check time window
    const groupTime = new Date(group.lastTimestamp).getTime();
    const hoursDiff = (msgTime - groupTime) / (1000 * 60 * 60);
    if (hoursDiff > maxHours || hoursDiff < 0) continue;

    let score = 1; // base score for sender match

    // Bonus for product overlap
    if (productLines && productLines.length > 0) {
      const msgProducts = new Set(
        productLines.map((pl) => pl.productCode).filter((c): c is string => c !== null)
      );
      const overlap = group.products.filter((p) => msgProducts.has(p)).length;
      if (overlap > 0) score += overlap * 3;
    }

    // Recency bonus (prefer more recent groups)
    score += Math.max(0, 5 - hoursDiff / 12);

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

// ─── Group Utilities ────────────────────────────────────────────────────────

function recalculateGroup(group: ProposedOrderGroup) {
  let total = 0;
  const allProducts = new Set<string>();

  for (const event of group.events) {
    for (const pl of event.productLines) {
      if (pl.productCode) allProducts.add(pl.productCode);

      switch (event.eventType) {
        case "INITIAL_ORDER":
        case "ADDITION":
        case "SUBSTITUTION_IN":
        case "CONFIRMATION":
          total += pl.qty;
          break;
        case "REDUCTION":
        case "SUBSTITUTION_OUT":
        case "CANCELLATION":
          total -= pl.qty;
          break;
      }
    }
  }

  group.totalOrderedQty = Math.max(0, total);
  group.products = Array.from(allProducts);

  if (group.events.length > 0) {
    const timestamps = group.events.map((e) => new Date(e.timestamp).getTime());
    group.firstTimestamp = new Date(Math.min(...timestamps)).toISOString();
    group.lastTimestamp = new Date(Math.max(...timestamps)).toISOString();
  }

  // Recalculate overall confidence
  const confs = group.events.map((e) => e.confidence);
  group.confidence = Math.round(confs.reduce((a, b) => a + b, 0) / confs.length);
}

function buildGroupLabel(sender: string, timestamp: string, products: string[]): string {
  const date = new Date(timestamp).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const firstName = sender.split(" ")[0];
  const productSummary = products.length > 0
    ? products.slice(0, 3).join(", ") + (products.length > 3 ? ` +${products.length - 3}` : "")
    : "mixed items";
  return `${firstName} — ${date} — ${productSummary}`;
}

// ─── Manual Operations ──────────────────────────────────────────────────────

/** Split a group at a specific event index */
export function splitGroup(
  group: ProposedOrderGroup,
  splitAtEventIndex: number
): [ProposedOrderGroup, ProposedOrderGroup] {
  const before = { ...group };
  const after = { ...group };

  before.events = group.events.slice(0, splitAtEventIndex);
  before.sourceMessageIds = before.events.map((e) => e.messageId);
  before.groupKey = group.groupKey + "-A";

  after.events = group.events.slice(splitAtEventIndex);
  after.sourceMessageIds = after.events.map((e) => e.messageId);
  after.groupKey = group.groupKey + "-B";
  after.label = buildGroupLabel(
    after.events[0]?.sender || group.sender,
    after.events[0]?.timestamp || group.firstTimestamp,
    after.events.flatMap((e) => e.productLines.map((pl) => pl.productCode).filter((c): c is string => c !== null))
  );

  recalculateGroup(before);
  recalculateGroup(after);

  return [before, after];
}

/** Merge two groups into one */
export function mergeGroups(
  groupA: ProposedOrderGroup,
  groupB: ProposedOrderGroup
): ProposedOrderGroup {
  const merged: ProposedOrderGroup = {
    groupKey: groupA.groupKey,
    label: groupA.label,
    sender: groupA.sender,
    events: [...groupA.events, ...groupB.events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ),
    totalOrderedQty: 0,
    products: [...new Set([...groupA.products, ...groupB.products])],
    firstTimestamp: groupA.firstTimestamp,
    lastTimestamp: groupB.lastTimestamp,
    confidence: Math.round((groupA.confidence + groupB.confidence) / 2),
    uncertainReasons: [
      ...groupA.uncertainReasons,
      ...groupB.uncertainReasons,
      "Groups manually merged",
    ],
    isUncertain: false,
    sourceMessageIds: [...groupA.sourceMessageIds, ...groupB.sourceMessageIds],
  };

  recalculateGroup(merged);
  return merged;
}
