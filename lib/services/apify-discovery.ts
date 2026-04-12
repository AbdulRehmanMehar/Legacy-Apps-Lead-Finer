/**
 * Apify-Powered Lead Discovery Service
 *
 * Uses Apify's Google Search Scraper actor to find B2B companies that are
 * confirmed to be running legacy technology stacks. Instead of random Tranco
 * domain sampling, every domain returned here has a credible legacy tech signal
 * visible in Google's index — which means Stage 2 (tech analysis) will produce
 * far higher legacy-detection rates.
 *
 * Query rotation strategy:
 *   Each Stage 1 tick picks the next bucket (Drupal 7, Magento 1, jQuery 1.x, …).
 *   Within a bucket we run multiple targeted queries and pool the results.
 *   This spreads API usage evenly across tech categories over time.
 */

import { ApifyClient } from 'apify-client';

// ─── Actor IDs ───────────────────────────────────────────────────────────────
const GOOGLE_SEARCH_ACTOR = 'apify/google-search-scraper';

// ─── Search settings ─────────────────────────────────────────────────────────
const RESULTS_PER_QUERY = 10;   // Google results per query page
const MAX_PAGES_PER_QUERY = 1;  // Only first page (10 results) per query
const ACTOR_TIMEOUT_SECS = 120; // Wait up to 2 min for actor completion

// ─── Domain blocklist ────────────────────────────────────────────────────────
// These are dev resources, forums, or mega-corps — never valid leads.
const BLOCKED_DOMAINS = new Set([
  'github.com', 'stackoverflow.com', 'drupal.org', 'magento.com', 'joomla.org',
  'wordpress.org', 'jquery.com', 'npmjs.com', 'packagist.org', 'oscommerce.com',
  'facebook.com', 'twitter.com', 'x.com', 'linkedin.com', 'instagram.com',
  'youtube.com', 'wikipedia.org', 'medium.com', 'reddit.com', 'amazon.com',
  'google.com', 'bing.com', 'cloudflare.com', 'microsoft.com', 'apple.com',
  'w3schools.com', 'tutorialspoint.com', 'geeksforgeeks.org', 'dev.to',
  'codepen.io', 'jsfiddle.net', 'pastebin.com', 'replit.com',
]);

// ─── TLD blocklist ───────────────────────────────────────────────────────────
const BLOCKED_TLDS = ['.gov', '.edu', '.mil'];

// ─── Query buckets ───────────────────────────────────────────────────────────
// Each bucket targets a different legacy tech. Buckets are rotated round-robin
// across Stage 1 ticks so we spread discovery across tech categories.
//
// Query design principles:
//   • inurl: patterns exploit URL signatures characteristic of each CMS/framework
//   • Negative filters (-site:) remove developer docs & community sites
//   • Business intent signals (services, contact, about, shop) filter out blogs
//   • This finds sites where the legacy tech is ACTIVELY RUNNING, not discussed

export const QUERY_BUCKETS: Array<{ name: string; queries: string[] }> = [
  {
    name: 'Drupal 7',
    queries: [
      // Generator meta tag: Drupal 7 embeds this EXACT string in every page's <head>.
      // No other software outputs this string, and Google indexes meta tag content.
      // This is the most precise Drupal 7 signal available via search.
      '"Drupal 7 (http://drupal.org)" site:*.com -drupal.org -github.com',
      // misc/drupal.js is Drupal 7's core JS file — Drupal 8+ switched to hashed
      // asset filenames under /core/, so this path is Drupal 6/7 only.
      'inurl:"misc/drupal.js" site:*.com -drupal.org -github.com -stackoverflow.com',
    ],
  },
  {
    name: 'Magento 1',
    queries: [
      // /skin/frontend/ is Magento 1's theme asset directory — completely removed in
      // Magento 2 which uses /pub/static/. Zero false positives.
      'inurl:"/skin/frontend/" site:*.com -github.com -magento.com',
      // /js/mage/ holds Magento 1's core JS — replaced by RequireJS in Magento 2.
      'inurl:"/js/mage/" site:*.com -github.com -magento.com',
      // /checkout/onepage/ is Magento 1's checkout URL — Magento 2 uses /checkout/
      'inurl:"/checkout/onepage/" site:*.com -github.com -magento.com',
    ],
  },
  {
    name: 'jQuery 1.x',
    queries: [
      // Hardcoded version numbers in filenames — a site serving jquery-1.11.js
      // from its own domain has not updated its JS stack in 8+ years.
      'inurl:"jquery-1.11" OR inurl:"jquery-1.12" site:*.com -github.com -npmjs.com -cdnjs.cloudflare.com',
      'inurl:"jquery-1.9" OR inurl:"jquery-1.10" site:*.com -github.com -npmjs.com -cdnjs.cloudflare.com',
    ],
  },
  {
    name: 'osCommerce',
    queries: [
      // /catalog/index.php is osCommerce's canonical entry point — no other major
      // platform uses this exact URL structure.
      'inurl:"/catalog/index.php" site:*.com -oscommerce.com -github.com',
      // osCommerce shopping cart URL — very specific
      'inurl:"/catalog/shopping_cart.php" site:*.com -oscommerce.com -github.com',
    ],
  },
  {
    name: 'Old WordPress (pre-5.0)',
    queries: [
      // Twenty Fifteen and Twenty Sixteen are WP 4.x era default themes — if a
      // business site is still running these it has not been updated in 6+ years.
      'inurl:"/wp-content/themes/twentyfifteen" site:*.com -wordpress.org services OR contact',
      'inurl:"/wp-content/themes/twentysixteen" site:*.com -wordpress.org services OR contact',
    ],
  },
  {
    name: 'ColdFusion',
    queries: [
      // .cfm is exclusively ColdFusion — no other framework uses this extension.
      // Adding business-intent words filters out documentation/tutorial sites.
      'inurl:".cfm" "contact us" site:*.com -github.com -stackoverflow.com -adobe.com',
      // /CFIDE/ is ColdFusion's admin directory — its presence in indexed URLs
      // is a dead giveaway that ColdFusion is running on the server.
      'inurl:"/CFIDE/" site:*.com -adobe.com -github.com -stackoverflow.com',
    ],
  },
  {
    name: 'Joomla 2.x / 3.x',
    queries: [
      // This exact phrase is Joomla's default HTML meta description / copyright
      // string. Google indexes it. Appears on Joomla 1.x–3.x sites.
      '"Joomla! - the dynamic portal engine and CMS" site:*.com -joomla.org',
      // /component/content/ is Joomla's component routing — unique to Joomla.
      'inurl:"/component/content" site:*.com -joomla.org -github.com services',
    ],
  },
  {
    name: 'Flash (EOL Dec 2020)',
    queries: [
      // Sites still serving .swf files are running software that is actively
      // broken for all users since Flash was delisted. Very urgent modernization need.
      'inurl:".swf" "contact us" site:*.com -github.com -archive.org -adobe.com',
      // Explicit "requires Flash Player" notices — these sites know they have a problem.
      '"requires flash player" "contact" site:*.com -adobe.com -github.com -stackoverflow.com',
    ],
  },
];

// ─── Bucket rotation state ────────────────────────────────────────────────────
let bucketIndex = 0;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractDomain(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  } catch {
    return null;
  }
}

function isBlockedDomain(domain: string): boolean {
  if (BLOCKED_DOMAINS.has(domain)) return true;
  if (BLOCKED_TLDS.some(tld => domain.endsWith(tld))) return true;
  // Skip subdomains of blocked roots (e.g. docs.github.com)
  for (const blocked of BLOCKED_DOMAINS) {
    if (domain.endsWith('.' + blocked)) return true;
  }
  return false;
}

// ─── Core actor runner ────────────────────────────────────────────────────────

interface SearchResultItem {
  url: string;
  title?: string;
  description?: string;
}

async function runGoogleSearchScraper(queries: string[]): Promise<SearchResultItem[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN is not configured');

  const client = new ApifyClient({ token });

  console.log(`   [Apify] Starting Google Search Scraper with ${queries.length} queries...`);

  const run = await client.actor(GOOGLE_SEARCH_ACTOR).call(
    {
      queries: queries.join('\n'),
      maxPagesPerQuery: MAX_PAGES_PER_QUERY,
      resultsPerPage: RESULTS_PER_QUERY,
      countryCode: 'us',
      languageCode: 'en',
      mobileResults: false,
      // Exclude sitelinks and knowledge graph results — we only want organic
      includeUnfilteredResults: false,
    },
    { waitSecs: ACTOR_TIMEOUT_SECS }
  );

  if (run.status !== 'SUCCEEDED') {
    throw new Error(`Apify actor run ended with status "${run.status}" (runId: ${run.id})`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  console.log(`   [Apify] Actor finished. Raw results: ${items.length}`);

  return items as unknown as SearchResultItem[];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ApifyDiscoveryResult {
  domains: string[];
  sources: { apify: number; bucket: string };
}

/**
 * Discover B2B domains using Apify's Google Search Scraper.
 *
 * Each call picks the next query bucket (round-robin across tech categories)
 * and runs targeted Google searches designed to surface business sites
 * with confirmed legacy technology footprints.
 *
 * @param maxResults - Maximum number of unique domains to return (default 50)
 */
export async function discoverLeadsViaApify(maxResults = 50): Promise<ApifyDiscoveryResult> {
  const bucket = QUERY_BUCKETS[bucketIndex % QUERY_BUCKETS.length];
  bucketIndex++;

  console.log(`[Apify Discovery] Bucket: "${bucket.name}" (${bucket.queries.length} queries)`);

  const rawItems = await runGoogleSearchScraper(bucket.queries);

  const domains = new Set<string>();
  for (const item of rawItems) {
    if (domains.size >= maxResults) break;
    if (!item.url) continue;

    const domain = extractDomain(item.url);
    if (!domain) continue;
    if (isBlockedDomain(domain)) continue;

    domains.add(domain);
  }

  const result = [...domains];
  console.log(`[Apify Discovery] Found ${result.length} candidate domains from "${bucket.name}" bucket.`);

  return {
    domains: result,
    sources: { apify: result.length, bucket: bucket.name },
  };
}

/**
 * Returns true if the Apify token is present in env.
 */
export function isApifyConfigured(): boolean {
  return Boolean(process.env.APIFY_API_TOKEN);
}
