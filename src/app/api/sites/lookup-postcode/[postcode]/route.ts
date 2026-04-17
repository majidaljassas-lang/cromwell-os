/**
 * UK postcode lookup via postcodes.io.
 *
 * Free, no API key required. Returns admin_district (city), admin_county,
 * region, country (England/Wales/Scotland/NI), and lat/lon. We don't get a
 * street/building from a postcode alone — for that you need a paid service
 * like getAddress.io or ideal-postcodes. This endpoint covers the 90% case:
 * "the user typed a postcode, autofill the locality fields".
 */

type PostcodesIoResponse = {
  status: number;
  result?: {
    postcode: string;
    admin_district: string | null;
    admin_county: string | null;
    admin_ward: string | null;
    parish: string | null;
    region: string | null;
    country: string | null;
    longitude: number | null;
    latitude: number | null;
    parliamentary_constituency: string | null;
  };
  error?: string;
};

function normalisePostcode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function formatPostcode(raw: string): string {
  // Royal Mail standard: insert a space before the inward code (last 3 chars)
  const cleaned = normalisePostcode(raw);
  if (cleaned.length < 5 || cleaned.length > 7) return raw.toUpperCase();
  return `${cleaned.slice(0, cleaned.length - 3)} ${cleaned.slice(-3)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ postcode: string }> }
) {
  const { postcode } = await params;
  const cleaned = normalisePostcode(postcode);

  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(cleaned)) {
    return Response.json(
      { error: "Invalid UK postcode format" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(cleaned)}`,
      { headers: { Accept: "application/json" } }
    );

    if (res.status === 404) {
      return Response.json(
        { error: "Postcode not found", postcode: formatPostcode(cleaned) },
        { status: 404 }
      );
    }
    if (!res.ok) {
      return Response.json(
        { error: `postcodes.io returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as PostcodesIoResponse;
    if (!data.result) {
      return Response.json({ error: data.error || "Empty response" }, { status: 502 });
    }

    return Response.json({
      postcode: formatPostcode(data.result.postcode),
      // City: admin_district is the most useful city-equivalent for the UK.
      // For London postcodes this returns the borough (e.g. "Westminster", "Camden"),
      // which matches how we already store London sites.
      city: data.result.admin_district || data.result.parish || "",
      county: data.result.admin_county || "",
      region: data.result.region || "",
      country: data.result.country || "United Kingdom",
      latitude: data.result.latitude,
      longitude: data.result.longitude,
      ward: data.result.admin_ward,
      constituency: data.result.parliamentary_constituency,
    });
  } catch (error) {
    console.error("Postcode lookup failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Lookup failed" },
      { status: 500 }
    );
  }
}
