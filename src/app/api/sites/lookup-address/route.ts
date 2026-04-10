import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type AddressMatch = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  postcode: string;
  country: string;
  score: number;
  sourceLabel: string;
};

type NominatimResult = {
  display_name?: string;
  importance?: number;
  address?: {
    house_number?: string;
    road?: string;
    pedestrian?: string;
    footway?: string;
    neighbourhood?: string;
    suburb?: string;
    quarter?: string;
    city_district?: string;
    district?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
};

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function scoreText(tokens: string[], text: string): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const tok of tokens) {
    if (lower.includes(tok)) hits += 1;
  }
  return tokens.length > 0 ? hits / tokens.length : 0;
}

function dedupeKey(m: { addressLine1: string; postcode: string; city: string }): string {
  return `${(m.addressLine1 || "").toLowerCase().trim()}|${(m.postcode || "")
    .toLowerCase()
    .trim()}|${(m.city || "").toLowerCase().trim()}`;
}

// Extract an address window from free text by finding a UK postcode.
function extractFromFreeText(
  text: string,
  sourceLabel: string,
  scoreBase: number,
  tokens: string[],
): AddressMatch | null {
  const pcMatch = text.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  if (!pcMatch) return null;
  const postcode = pcMatch[1].toUpperCase().replace(/\s+/g, " ").trim();

  const idx = text.indexOf(pcMatch[0]);
  const windowStart = Math.max(0, idx - 200);
  const window = text.slice(windowStart, idx);
  const parts = window
    .split(/[\n,]/)
    .map((s) => s.replace(/[{}\[\]":]/g, " ").replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 2 && !/^[a-zA-Z_]+$/.test(s));
  const tail = parts.slice(-4);
  const al1 = tail[tail.length - 2] || tail[tail.length - 1] || "";
  const city = tail[tail.length - 1] || "";
  const m: AddressMatch = {
    addressLine1: al1,
    addressLine2: "",
    city: city && city.toUpperCase() !== postcode ? city : "",
    postcode,
    country: "UK",
    score:
      scoreBase * (0.5 + 0.5 * scoreText(tokens, `${al1} ${city} ${postcode}`)),
    sourceLabel,
  };
  return m.addressLine1 || m.postcode ? m : null;
}

async function searchInternal(q: string): Promise<AddressMatch[]> {
  const tokens = tokenize(q);
  if (tokens.length === 0) return [];

  const results: AddressMatch[] = [];
  const seen = new Set<string>();

  // 1. Site table — canonical, highest confidence
  const siteRows = await prisma.site.findMany({
    where: {
      OR: [
        { siteName: { contains: q, mode: "insensitive" } },
        { addressLine1: { contains: q, mode: "insensitive" } },
        { addressLine2: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { postcode: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      siteName: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      postcode: true,
      country: true,
    },
    take: 20,
  });

  for (const s of siteRows) {
    if (!s.addressLine1 && !s.postcode && !s.city) continue;
    const combined = [s.siteName, s.addressLine1, s.addressLine2, s.city, s.postcode]
      .filter(Boolean)
      .join(" ");
    const m: AddressMatch = {
      addressLine1: s.addressLine1 ?? "",
      addressLine2: s.addressLine2 ?? "",
      city: s.city ?? "",
      postcode: s.postcode ?? "",
      country: s.country ?? "UK",
      score: 0.1 + 0.9 * scoreText(tokens, combined),
      sourceLabel: `Existing site: ${s.siteName}`,
    };
    const key = dedupeKey(m);
    if (!seen.has(key)) {
      seen.add(key);
      results.push(m);
    }
  }

  // 2. Customer.billingAddress
  const customerRows = await prisma.customer.findMany({
    where: { billingAddress: { contains: q, mode: "insensitive" } },
    select: { name: true, billingAddress: true },
    take: 10,
  });

  for (const c of customerRows) {
    if (!c.billingAddress) continue;
    const m = extractFromFreeText(c.billingAddress, `Customer: ${c.name}`, 0.7, tokens);
    if (!m) continue;
    if (!m.addressLine1) {
      const firstLine = c.billingAddress
        .split(/\r?\n|,/)
        .map((l) => l.trim())
        .filter(Boolean)[0];
      if (firstLine) m.addressLine1 = firstLine;
    }
    const key = dedupeKey(m);
    if (!seen.has(key) && (m.addressLine1 || m.postcode)) {
      seen.add(key);
      results.push(m);
    }
  }

  // 3. ProcurementOrder.siteRef
  const poRows = await prisma.procurementOrder.findMany({
    where: { siteRef: { contains: q, mode: "insensitive" } },
    select: { poNo: true, siteRef: true },
    take: 10,
  });

  for (const p of poRows) {
    if (!p.siteRef) continue;
    const extracted = extractFromFreeText(p.siteRef, `PO ${p.poNo}`, 0.65, tokens);
    const m: AddressMatch = extracted ?? {
      addressLine1: p.siteRef.split(/\r?\n|,/)[0]?.trim() ?? "",
      addressLine2: "",
      city: "",
      postcode: "",
      country: "UK",
      score: 0.4 * scoreText(tokens, p.siteRef),
      sourceLabel: `PO ${p.poNo}`,
    };
    const key = dedupeKey(m);
    if (!seen.has(key) && (m.addressLine1 || m.postcode)) {
      seen.add(key);
      results.push(m);
    }
  }

  // 4. Expensive fallback: IngestionEvent.rawPayload JSON cast
  if (results.length === 0) {
    const like = `%${q}%`;
    const rawRows = await prisma.$queryRaw<
      Array<{ id: string; eventKind: string | null; rawPayload: unknown }>
    >`
      SELECT "id", "eventKind", "rawPayload"
      FROM "IngestionEvent"
      WHERE "rawPayload"::text ILIKE ${like}
      ORDER BY "receivedAt" DESC
      LIMIT 25
    `;

    for (const row of rawRows) {
      const text = JSON.stringify(row.rawPayload ?? {});
      const m = extractFromFreeText(
        text,
        `Email payload${row.eventKind ? ` (${row.eventKind})` : ""}`,
        0.6,
        tokens,
      );
      if (!m) continue;
      const key = dedupeKey(m);
      if (!seen.has(key) && m.addressLine1) {
        seen.add(key);
        results.push(m);
      }
    }
  }

  return results
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

async function searchNominatim(q: string): Promise<AddressMatch[]> {
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q,
      format: "json",
      addressdetails: "1",
      countrycodes: "gb",
      limit: "5",
    }).toString();

  const res = await fetch(url, {
    headers: {
      "User-Agent": "cromwell-os/1.0 (info@cromwellplumbing.co.uk)",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) return [];

  const raw = (await res.json()) as NominatimResult[];
  const matches: AddressMatch[] = [];
  for (const r of raw) {
    const a = r.address;
    if (!a) continue;
    const street = a.road ?? a.pedestrian ?? a.footway ?? "";
    const houseNumber = a.house_number ?? "";
    const addressLine1 = [houseNumber, street].filter(Boolean).join(" ").trim();
    const addressLine2 =
      a.neighbourhood ?? a.suburb ?? a.quarter ?? a.city_district ?? a.district ?? "";
    const city =
      a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.county ?? a.state ?? "";
    const postcode = (a.postcode ?? "").toUpperCase();
    if (!addressLine1 && !postcode) continue;
    matches.push({
      addressLine1,
      addressLine2,
      city,
      postcode,
      country: "UK",
      score: Math.min(0.6, r.importance ?? 0.3),
      sourceLabel: "OpenStreetMap",
    });
  }
  return matches.slice(0, 5);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();

    if (q.length < 2) {
      return NextResponse.json({ source: "internal", matches: [] });
    }

    // Internal DB lookup first — gets smarter as more emails arrive
    const internal = await searchInternal(q);
    if (internal.length > 0) {
      return NextResponse.json({ source: "internal", matches: internal });
    }

    // Fall through to Nominatim only if nothing internally
    try {
      const external = await searchNominatim(q);
      return NextResponse.json({ source: "nominatim", matches: external });
    } catch (err) {
      return NextResponse.json({
        source: "nominatim",
        matches: [],
        error: err instanceof Error ? err.message : "Nominatim unreachable",
      });
    }
  } catch (error) {
    console.error("Failed to lookup address:", error);
    return NextResponse.json(
      {
        source: "internal",
        matches: [],
        error: error instanceof Error ? error.message : "Failed to lookup address",
      },
      { status: 500 },
    );
  }
}
