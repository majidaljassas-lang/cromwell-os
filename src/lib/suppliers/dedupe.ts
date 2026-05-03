/**
 * Supplier dedupe + merge.
 *
 * findClusters() — uses pg_trgm to find groups of suppliers whose names are
 * similar above a threshold. Returns each member with link counts so the UI
 * can suggest a keeper (most-linked wins).
 *
 * mergeSuppliers() — repoints every FK that references a "loser" supplier
 * to the "keeper", aliases the loser's name (and existing aliases) onto the
 * keeper, then deletes the loser. The FK list is discovered dynamically
 * from information_schema so future relations get covered automatically.
 *
 * Wraps the whole repoint + delete in a single transaction so a half-merged
 * supplier is impossible.
 */

import { prisma } from "@/lib/prisma";

const DEFAULT_THRESHOLD = 0.65;

export interface ClusterMember {
  id: string;
  name: string;
  legalName: string | null;
  email: string | null;
  ticketLines: number;
  bills: number;
  procurementOrders: number;
  aliases: number;
  totalLinks: number;
}

export interface SupplierCluster {
  key: string;
  members: ClusterMember[];
  bestPairScore: number;
  suggestedKeeperId: string;
}

export async function findClusters(
  threshold = DEFAULT_THRESHOLD,
): Promise<SupplierCluster[]> {
  // Build the symmetric similarity graph above the threshold
  const pairs = await prisma.$queryRaw<
    Array<{ a_id: string; b_id: string; score: number }>
  >`
    SELECT a.id AS a_id, b.id AS b_id,
           GREATEST(similarity(a.name, b.name), word_similarity(a.name, b.name)) AS score
      FROM "Supplier" a
      JOIN "Supplier" b ON a.id < b.id
     WHERE GREATEST(similarity(a.name, b.name), word_similarity(a.name, b.name)) > ${threshold};
  `;

  if (pairs.length === 0) return [];

  // Union-find to group connected suppliers
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (!p || p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const p of pairs) {
    if (!parent.has(p.a_id)) parent.set(p.a_id, p.a_id);
    if (!parent.has(p.b_id)) parent.set(p.b_id, p.b_id);
    union(p.a_id, p.b_id);
  }

  const clusterIds = new Map<string, Set<string>>();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!clusterIds.has(root)) clusterIds.set(root, new Set());
    clusterIds.get(root)!.add(id);
  }

  // Best score within each cluster, for sorting
  const bestScoreByRoot = new Map<string, number>();
  for (const p of pairs) {
    const root = find(p.a_id);
    const cur = bestScoreByRoot.get(root) ?? 0;
    if (Number(p.score) > cur) bestScoreByRoot.set(root, Number(p.score));
  }

  // Pull supplier rows + link counts in one shot
  const allIds = [...parent.keys()];
  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: allIds } },
    select: {
      id: true,
      name: true,
      legalName: true,
      email: true,
      _count: {
        select: {
          ticketLines: true,
          supplierBills: true,
          procurementOrders: true,
          aliases: true,
        },
      },
    },
  });

  const byId = new Map(suppliers.map((s) => [s.id, s]));

  const clusters: SupplierCluster[] = [];
  for (const [root, ids] of clusterIds) {
    if (ids.size < 2) continue;
    const members: ClusterMember[] = [...ids]
      .map((id) => {
        const s = byId.get(id);
        if (!s) return null;
        const totalLinks =
          s._count.ticketLines +
          s._count.supplierBills +
          s._count.procurementOrders;
        return {
          id: s.id,
          name: s.name,
          legalName: s.legalName,
          email: s.email,
          ticketLines: s._count.ticketLines,
          bills: s._count.supplierBills,
          procurementOrders: s._count.procurementOrders,
          aliases: s._count.aliases,
          totalLinks,
        } satisfies ClusterMember;
      })
      .filter((x): x is ClusterMember => x !== null)
      .sort((a, b) => b.totalLinks - a.totalLinks);
    if (members.length < 2) continue;
    clusters.push({
      key: root,
      members,
      bestPairScore: bestScoreByRoot.get(root) ?? 0,
      suggestedKeeperId: members[0].id, // most-linked wins
    });
  }

  // Highest-scoring clusters first
  clusters.sort((a, b) => b.bestPairScore - a.bestPairScore);
  return clusters;
}

export interface MergeResult {
  keeperId: string;
  loserId: string;
  loserName: string;
  rowsRepointed: { table: string; column: string; rows: number }[];
  aliasesMoved: number;
  loserAliasedOnKeeper: boolean;
}

/**
 * Merge `loserId` into `keeperId`. Repoints every FK referencing the loser,
 * moves aliases, adds the loser's name as an alias on the keeper, then
 * deletes the loser.
 */
export async function mergeSuppliers(
  keeperId: string,
  loserId: string,
): Promise<MergeResult> {
  if (keeperId === loserId) throw new Error("Keeper and loser are the same");
  const [keeper, loser] = await Promise.all([
    prisma.supplier.findUnique({ where: { id: keeperId }, select: { id: true, name: true } }),
    prisma.supplier.findUnique({ where: { id: loserId }, select: { id: true, name: true } }),
  ]);
  if (!keeper) throw new Error(`Keeper not found: ${keeperId}`);
  if (!loser) throw new Error(`Loser not found: ${loserId}`);

  // Discover all FK constraints pointing to "Supplier"(id).
  const fks = await prisma.$queryRaw<
    Array<{ table_name: string; column_name: string }>
  >`
    SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND ccu.table_name = 'Supplier'
       AND ccu.column_name = 'id'
       AND tc.table_schema = current_schema()
       AND tc.table_name <> 'Supplier';
  `;

  const rowsRepointed: { table: string; column: string; rows: number }[] = [];
  let aliasesMoved = 0;
  let loserAliasedOnKeeper = false;

  await prisma.$transaction(async (tx) => {
    // 1. Move SupplierAlias rows from loser → keeper, but skip any that
    // would collide with an existing keeper alias (unique on supplierId+alias).
    const loserAliases = await tx.supplierAlias.findMany({
      where: { supplierId: loserId },
      select: { id: true, alias: true },
    });
    for (const a of loserAliases) {
      const collision = await tx.supplierAlias.findFirst({
        where: { supplierId: keeperId, alias: a.alias },
        select: { id: true },
      });
      if (collision) {
        await tx.supplierAlias.delete({ where: { id: a.id } });
      } else {
        await tx.supplierAlias.update({
          where: { id: a.id },
          data: { supplierId: keeperId },
        });
        aliasesMoved++;
      }
    }

    // 2. Repoint every FK referencing the loser. Done before delete because
    // some FKs may not have ON DELETE CASCADE.
    for (const fk of fks) {
      if (fk.table_name === "SupplierAlias") continue; // already handled
      const sql = `UPDATE "${fk.table_name}" SET "${fk.column_name}" = $1 WHERE "${fk.column_name}" = $2`;
      const res = await tx.$executeRawUnsafe(sql, keeperId, loserId);
      if (res > 0) {
        rowsRepointed.push({
          table: fk.table_name,
          column: fk.column_name,
          rows: res,
        });
      }
    }

    // 3. Add the loser's name as an alias on the keeper (skip if already there
    // or identical to keeper's name).
    if (loser.name.trim().toLowerCase() !== keeper.name.trim().toLowerCase()) {
      const exists = await tx.supplierAlias.findFirst({
        where: { supplierId: keeperId, alias: { equals: loser.name, mode: "insensitive" } },
        select: { id: true },
      });
      if (!exists) {
        await tx.supplierAlias.create({
          data: {
            supplierId: keeperId,
            alias: loser.name,
            source: "USER",
            observationCount: 1,
            lastSeenAt: new Date(),
          },
        });
        loserAliasedOnKeeper = true;
      }
    }

    // 4. Delete the loser
    await tx.supplier.delete({ where: { id: loserId } });
  });

  return {
    keeperId,
    loserId,
    loserName: loser.name,
    rowsRepointed,
    aliasesMoved,
    loserAliasedOnKeeper,
  };
}
