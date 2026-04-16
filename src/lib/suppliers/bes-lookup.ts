/**
 * BES Product Lookup
 *
 * Fetches product details from bes.co.uk by product code.
 * No API key or login needed — prices are public.
 *
 * Flow: search by code → follow product page → extract JSON-LD + HTML data.
 */

export interface BesProduct {
  besCode: string;
  name: string;
  priceExVat: number;
  priceIncVat: number;
  inStock: boolean;
  productUrl: string;
  description?: string;
  brand?: string;
}

export interface BesLookupResult {
  found: BesProduct[];
  notFound: string[];
  errors: Array<{ code: string; error: string }>;
}

const SEARCH_URL = "https://www.bes.co.uk/catalogsearch/result/?q=";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Extract product page URL from search results HTML.
 * BES product URLs follow: /slug-{code}/
 */
function extractProductUrl(html: string, code: string): string | null {
  // Look for the product link containing the code
  const patterns = [
    // href="/product-name-CODE/"
    new RegExp(`href="(https?://www\\.bes\\.co\\.uk/[^"]*-${code}/)"`, "i"),
    // href="/product-name-CODE/"  (relative)
    new RegExp(`href="(/[^"]*-${code}/)"`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const url = match[1];
      return url.startsWith("http") ? url : `https://www.bes.co.uk${url}`;
    }
  }
  return null;
}

/**
 * Extract JSON-LD Product data from a product page.
 */
function extractJsonLd(html: string): Record<string, unknown> | null {
  const matches = html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of matches) {
    try {
      const data = JSON.parse(match[1]);
      if (data["@type"] === "Product") return data;
      if (Array.isArray(data)) {
        const product = data.find((d: Record<string, unknown>) => d["@type"] === "Product");
        if (product) return product;
      }
    } catch { /* skip invalid JSON-LD */ }
  }
  return null;
}

/**
 * Extract price from HTML when JSON-LD is missing or incomplete.
 */
function extractPriceFromHtml(html: string): { exVat: number; incVat: number } | null {
  // BES shows "£X.XX (inc. VAT)" and "£X.XX (ex. VAT)" or "Excl. Tax: £X.XX"
  const exVatMatch = html.match(/(?:ex\.?\s*vat|excl\.?\s*tax)[^£]*£([\d,.]+)/i)
    || html.match(/£([\d,.]+)[^£]*(?:ex\.?\s*vat|excl\.?\s*tax)/i);
  const incVatMatch = html.match(/(?:inc\.?\s*vat|incl\.?\s*tax)[^£]*£([\d,.]+)/i)
    || html.match(/£([\d,.]+)[^£]*(?:inc\.?\s*vat|incl\.?\s*tax)/i);

  if (exVatMatch || incVatMatch) {
    const exVat = exVatMatch ? Number(exVatMatch[1].replace(/,/g, "")) : 0;
    const incVat = incVatMatch ? Number(incVatMatch[1].replace(/,/g, "")) : 0;
    return {
      exVat: exVat || (incVat / 1.2),
      incVat: incVat || (exVat * 1.2),
    };
  }

  // Fallback: any price on the page
  const priceMatch = html.match(/£([\d,.]+)/);
  if (priceMatch) {
    const p = Number(priceMatch[1].replace(/,/g, ""));
    return { exVat: p / 1.2, incVat: p };
  }

  return null;
}

/**
 * Extract product name from HTML.
 */
function extractNameFromHtml(html: string): string | null {
  // <h1> tag typically has the product name
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) return h1Match[1].trim();

  // og:title
  const ogMatch = html.match(/<meta[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i);
  if (ogMatch) return ogMatch[1].trim();

  return null;
}

/**
 * Check if the search results indicate "no results".
 */
function isNoResults(html: string): boolean {
  return /no\s*results?\s*found/i.test(html)
    || /your\s*search\s*returned?\s*no/i.test(html)
    || /"0 Item"/i.test(html);
}

/**
 * Look up a single BES product code.
 */
async function lookupOne(code: string): Promise<BesProduct | null> {
  // Step 1: Search
  const searchRes = await fetch(`${SEARCH_URL}${code}`, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });

  if (!searchRes.ok) return null;

  const searchHtml = await searchRes.text();

  // Check if we were redirected directly to a product page (single result)
  const finalUrl = searchRes.url;
  const isProductPage = finalUrl.includes(`-${code}/`) || finalUrl.match(/\/[a-z].*-\d+\//i);

  let productHtml: string;
  let productUrl: string;

  if (isProductPage) {
    productHtml = searchHtml;
    productUrl = finalUrl;
  } else {
    // Search results page — extract product link
    if (isNoResults(searchHtml)) return null;

    const url = extractProductUrl(searchHtml, code);
    if (!url) return null;

    productUrl = url;
    const productRes = await fetch(productUrl, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    if (!productRes.ok) return null;
    productHtml = await productRes.text();
  }

  // Step 2: Extract data from product page
  const jsonLd = extractJsonLd(productHtml);

  let name: string | null = null;
  let priceExVat = 0;
  let priceIncVat = 0;
  let inStock = true;
  let description: string | undefined;
  let brand: string | undefined;

  if (jsonLd) {
    name = (jsonLd.name as string) || null;
    description = (jsonLd.description as string) || undefined;
    brand = typeof jsonLd.brand === "string"
      ? jsonLd.brand
      : (jsonLd.brand as Record<string, unknown>)?.name as string | undefined;

    const offers = jsonLd.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
    const offer = Array.isArray(offers) ? offers[0] : offers;
    if (offer) {
      const p = Number(offer.price ?? 0);
      if (p > 0) {
        // JSON-LD price is typically inc-VAT on BES
        priceIncVat = p;
        priceExVat = Math.round((p / 1.2) * 100) / 100;
      }
      inStock = offer.availability !== "https://schema.org/OutOfStock"
        && offer.availability !== "OutOfStock";
    }
  }

  // Fallback to HTML extraction
  if (!name) name = extractNameFromHtml(productHtml);
  if (!name) return null;

  if (priceExVat === 0) {
    const htmlPrice = extractPriceFromHtml(productHtml);
    if (htmlPrice) {
      priceExVat = Math.round(htmlPrice.exVat * 100) / 100;
      priceIncVat = Math.round(htmlPrice.incVat * 100) / 100;
    }
  }

  return {
    besCode: code,
    name,
    priceExVat,
    priceIncVat,
    inStock,
    productUrl,
    description,
    brand,
  };
}

/**
 * Look up multiple BES codes. Throttled to avoid hammering the site.
 */
export async function besLookup(codes: string[]): Promise<BesLookupResult> {
  const result: BesLookupResult = { found: [], notFound: [], errors: [] };

  for (const code of codes) {
    try {
      const product = await lookupOne(code.trim());
      if (product) {
        result.found.push(product);
      } else {
        result.notFound.push(code);
      }
    } catch (err) {
      result.errors.push({
        code,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Throttle: 500ms between requests
    await new Promise((r) => setTimeout(r, 500));
  }

  return result;
}
