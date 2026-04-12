/**
 * Domain Preflight Filter
 *
 * Runs a cheap HTTP check on candidate domains before they enter the analysis
 * queue. Filters out three categories of non-leads:
 *
 *   1. Dead / unreachable — Puppeteer would fail on them anyway.
 *   2. Modern hosted platforms — Shopify, Wix, Squarespace, Webflow, etc.
 *      These are definitively NOT legacy and have no modernisation opportunity.
 *   3. Parked / for-sale domains — no real business behind them.
 *
 * Checks run in parallel (default concurrency = 8) with a 6-second timeout
 * per domain. We try HTTPS first, fall back to HTTP for old sites without SSL.
 *
 * Only the first ~4 KB of the response body is inspected — enough to cover
 * the <head> section where generator meta tags and CDN script URLs live.
 */

// ─── Modern platform redirect targets ────────────────────────────────────────
// If a domain redirects to any of these hostnames we know it's on a modern
// SaaS platform and is not a legacy self-hosted site.
const MODERN_PLATFORM_HOST_PATTERNS: RegExp[] = [
  /\.myshopify\.com$/,
  /^shopify\.com$/,
  /\.wixsite\.com$/,
  /\.wix\.com$/,
  /\.squarespace\.com$/,
  /\.webflow\.io$/,
  /\.godaddysites\.com$/,
  /\.wordpress\.com$/,        // wordpress.com hosted (not self-hosted WP)
  /\.ghost\.io$/,
  /\.netlify\.app$/,
  /\.vercel\.app$/,
  /\.pages\.dev$/,            // Cloudflare Pages
  /\.framer\.app$/,
  /\.notion\.site$/,
  /\.cargo\.site$/,
  /\.jimdo\.com$/,
  /\.weebly\.com$/,
  /\.strikingly\.com$/,
];

// ─── Modern platform response headers ────────────────────────────────────────
// Header name → value pattern. Any match → not a legacy lead.
const MODERN_PLATFORM_HEADERS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'x-shopify-stage',     pattern: /.+/ },
  { name: 'x-shopid',            pattern: /.+/ },
  { name: 'x-wix-request-id',    pattern: /.+/ },
  { name: 'x-vercel-id',         pattern: /.+/ },
  { name: 'x-netlify',           pattern: /.+/ },
  { name: 'server',              pattern: /^netlify$/i },
  { name: 'server',              pattern: /^github\.com$/i },
  { name: 'x-powered-by',        pattern: /^next\.js$/i },   // Vercel/modern Next
  { name: 'x-powered-by',        pattern: /^shopify$/i },
];

// ─── Body-level signals (checked in first 4 KB) ──────────────────────────────
// Generator meta tag patterns that confirm a modern hosted platform.
// These appear early in <head> so 4 KB is always enough.
const MODERN_BODY_PATTERNS: RegExp[] = [
  /generator["']?\s*content=["']wix/i,
  /generator["']?\s*content=["']squarespace/i,
  /data-wf-site=/i,                        // Webflow
  /cdn\.shopify\.com/i,                    // Shopify CDN
  /\/\/static\.parastorage\.com/i,         // Wix static CDN
  /netlify-identity-widget/i,
];

// ─── Parked domain signals ────────────────────────────────────────────────────
// Substrings in page text (lowercased) that indicate a parked/for-sale domain.
const PARKED_SIGNALS: string[] = [
  'this domain is for sale',
  'domain is parked',
  'buy this domain',
  'parked by',
  'sedo.com',
  'hugedomains.com',
  'dan.com',
  'afternic.com',
  'domain for sale',
  'make an offer',
  'this web page is parked',
  'godaddy.com/domainsearch',
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PreflightResult {
  domain: string;
  pass: boolean;
  reason?: string;  // populated only when pass=false
}

// ─── Per-domain check ────────────────────────────────────────────────────────

async function checkDomain(domain: string): Promise<PreflightResult> {
  // Try HTTPS first, then fall back to plain HTTP (many legacy sites lack SSL)
  for (const protocol of ['https', 'http'] as const) {
    let response: Response;
    try {
      response = await fetch(`${protocol}://${domain}`, {
        method: 'GET',
        signal: AbortSignal.timeout(6000),
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
    } catch {
      // HTTPS failed — try HTTP on next iteration; if HTTP also fails, mark dead
      if (protocol === 'https') continue;
      return { domain, pass: false, reason: 'Unreachable on HTTPS and HTTP' };
    }

    // ── Check redirect destination ──────────────────────────────────────────
    try {
      const finalHost = new URL(response.url).hostname.toLowerCase();
      for (const pattern of MODERN_PLATFORM_HOST_PATTERNS) {
        if (pattern.test(finalHost)) {
          return { domain, pass: false, reason: `Hosted platform redirect → ${finalHost}` };
        }
      }
    } catch { /* malformed URL — ignore */ }

    // ── Check response headers ──────────────────────────────────────────────
    for (const { name, pattern } of MODERN_PLATFORM_HEADERS) {
      const value = response.headers.get(name);
      if (value && pattern.test(value)) {
        return { domain, pass: false, reason: `Modern platform header: ${name}: ${value}` };
      }
    }

    // ── Read first 4 KB of body ─────────────────────────────────────────────
    let bodySnippet = '';
    try {
      const full = await response.text();
      bodySnippet = full.slice(0, 4096);
    } catch { /* body unreadable — still pass, Stage 2 will decide */ }

    // ── Modern platform generator/CDN signals ───────────────────────────────
    for (const pattern of MODERN_BODY_PATTERNS) {
      if (pattern.test(bodySnippet)) {
        return { domain, pass: false, reason: `Modern platform body signal: ${pattern}` };
      }
    }

    // ── Parked / for-sale domain ────────────────────────────────────────────
    const bodyLower = bodySnippet.toLowerCase();
    for (const signal of PARKED_SIGNALS) {
      if (bodyLower.includes(signal)) {
        return { domain, pass: false, reason: `Parked domain: "${signal}"` };
      }
    }

    // Passed all checks on this protocol — no need to try HTTP
    return { domain, pass: true };
  }

  return { domain, pass: false, reason: 'Unreachable' };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run preflight checks on a list of domains in parallel.
 * Returns only the domains that pass all checks.
 *
 * @param domains     Candidate domains to check
 * @param concurrency Max simultaneous HTTP connections (default 8)
 */
export async function preflightFilter(
  domains: string[],
  concurrency = 8,
): Promise<string[]> {
  if (domains.length === 0) return [];

  console.log(`[Preflight] Checking ${domains.length} domains (concurrency=${concurrency})...`);
  const results: PreflightResult[] = [];

  // Process in fixed-size chunks to cap concurrency
  for (let i = 0; i < domains.length; i += concurrency) {
    const chunk = domains.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map(checkDomain));
    results.push(...chunkResults);
  }

  const passed = results.filter(r => r.pass).map(r => r.domain);
  const rejected = results.filter(r => !r.pass);

  console.log(`[Preflight] ${passed.length}/${domains.length} passed. Rejected: ${rejected.length}`);
  for (const r of rejected) {
    console.log(`   [Preflight] ✗ ${r.domain} — ${r.reason}`);
  }

  return passed;
}
