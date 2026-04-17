/**
 * Companies House Public Data API proxy.
 *
 * Why this exists: when the user types a UK company number on the customer form
 * and clicks "Lookup", we need to fetch the registered name + office address
 * server-side so the API key never reaches the browser.
 *
 * Auth: HTTP Basic with the API key as the username and an empty password.
 * Get a free key at https://developer.company-information.service.gov.uk/
 * and put it in .env as COMPANIES_HOUSE_API_KEY.
 */

type CompaniesHouseAddress = {
  address_line_1?: string;
  address_line_2?: string;
  locality?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  premises?: string;
};

type CompaniesHouseResponse = {
  company_number?: string;
  company_name?: string;
  company_status?: string;
  date_of_creation?: string;
  type?: string;
  registered_office_address?: CompaniesHouseAddress;
};

function formatAddress(addr: CompaniesHouseAddress | undefined): string {
  if (!addr) return "";
  const parts = [
    [addr.premises, addr.address_line_1].filter(Boolean).join(" "),
    addr.address_line_2,
    addr.locality,
    addr.region,
    addr.postal_code,
    addr.country,
  ].filter(Boolean) as string[];
  return parts.join("\n");
}

function normaliseNumber(raw: string): string {
  // Companies House numbers are 8 chars, sometimes shown with spaces or lowercase prefix.
  // Strip whitespace, uppercase, then left-pad numerics to 8 digits.
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  if (/^\d+$/.test(cleaned)) return cleaned.padStart(8, "0");
  return cleaned;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ number: string }> }
) {
  const { number } = await params;
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;

  if (!apiKey) {
    return Response.json(
      {
        error: "COMPANIES_HOUSE_API_KEY not configured",
        hint: "Get a free key at https://developer.company-information.service.gov.uk/ and add it to .env",
      },
      { status: 503 }
    );
  }

  const cleaned = normaliseNumber(number);
  if (!/^[A-Z0-9]{1,10}$/.test(cleaned)) {
    return Response.json({ error: "Invalid company number format" }, { status: 400 });
  }

  try {
    const auth = Buffer.from(`${apiKey}:`).toString("base64");
    const res = await fetch(
      `https://api.company-information.service.gov.uk/company/${encodeURIComponent(cleaned)}`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } }
    );

    if (res.status === 404) {
      return Response.json({ error: "Company not found", companyNumber: cleaned }, { status: 404 });
    }
    if (res.status === 401 || res.status === 403) {
      return Response.json({ error: "Companies House rejected the API key" }, { status: 502 });
    }
    if (!res.ok) {
      return Response.json(
        { error: `Companies House returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as CompaniesHouseResponse;

    return Response.json({
      companyNumber: data.company_number ?? cleaned,
      companyName: data.company_name ?? null,
      legalName: data.company_name ?? null,
      billingAddress: formatAddress(data.registered_office_address),
      registeredOfficeAddress: data.registered_office_address ?? null,
      companyStatus: data.company_status ?? null,
      dateOfCreation: data.date_of_creation ?? null,
      companyType: data.type ?? null,
    });
  } catch (error) {
    console.error("Companies House lookup failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Lookup failed" },
      { status: 500 }
    );
  }
}
