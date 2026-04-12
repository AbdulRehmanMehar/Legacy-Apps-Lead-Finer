import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { discoverLeadsViaApify, isApifyConfigured } from './apify-discovery';

/**
 * Lead Discovery Service
 *
 * PRIMARY:  Apify Google Search Scraper — finds B2B sites with confirmed legacy
 *           tech signals (Drupal 7, Magento 1, jQuery 1.x, etc.). Dramatically
 *           higher lead quality than random domain sampling.
 *
 * FALLBACK: Tranco Top 1M list — used only when APIFY_API_TOKEN is missing or
 *           the actor call fails. Random sampling; low quality but zero cost.
 */

// ==========================================
// LEGACY TECH MAP (kept for reference / typing)
// ==========================================
export const LEGACY_TECH_MAP: Record<string, any> = {
  'Drupal 7': {},
  'Drupal 6': {},
  'Magento 1': {},
  'Joomla 2': {},
  'jQuery 1.x': {},
  'WordPress < 4': {},
  'osCommerce': {},
  'PrestaShop 1.5': {},
};

export const TECH_LIST = Object.keys(LEGACY_TECH_MAP);

export function getNextLegacyTech(seed: number): string {
  return TECH_LIST[seed % TECH_LIST.length];
}

// ==========================================
// TRANCO FALLBACK
// ==========================================

const CACHE_DIR = path.join(os.tmpdir(), 'legacy-leads-discovery');
const CSV_PATH = path.join(CACHE_DIR, 'top-1m.csv');

function ensureTrancoList() {
  if (fs.existsSync(CSV_PATH)) {
    const stats = fs.statSync(CSV_PATH);
    const ageDays = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageDays < 7) return;
  }

  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  console.log(`   [Tranco] Downloading latest Top 1M domains list...`);
  const zipPath = path.join(CACHE_DIR, 'top-1m.zip');

  try {
    execSync(`curl -sL "https://tranco-list.eu/top-1m.csv.zip" > "${zipPath}"`);
    execSync(`unzip -p "${zipPath}" > "${CSV_PATH}"`);
    fs.unlinkSync(zipPath);
    console.log(`   [Tranco] Downloaded and extracted successfully.`);
  } catch (error) {
    console.error(`   [Tranco] Error fetching list:`, error);
    if (!fs.existsSync(CSV_PATH)) {
      fs.writeFileSync(CSV_PATH, '1,example.com\n2,test.com\n');
    }
  }
}

const TRANCO_SKIP_DOMAINS = new Set([
  'facebook.com', 'twitter.com', 'x.com', 'linkedin.com', 'instagram.com',
  'youtube.com', 'github.com', 'npmjs.com', 'stackoverflow.com',
  'wikipedia.org', 'medium.com', 'reddit.com', 'amazon.com', 'google.com',
  'bing.com', 'cloudflare.com', 'wordpress.org', 'drupal.org', 'joomla.org',
]);

function discoverViaTrancoPollback(
  maxResults: number
): { domains: string[]; sources: { tranco: number } } {
  ensureTrancoList();

  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = content.split('\n');

  if (lines.length < 100000) {
    return { domains: [], sources: { tranco: 0 } };
  }

  const startIdx = 100000; // Skip top 100k — too large to be legacy SMB leads
  const endIdx = lines.length - 1;
  const poolSize = endIdx - startIdx;

  const selectedDomains = new Set<string>();
  let attempts = 0;

  while (selectedDomains.size < maxResults && attempts < maxResults * 10) {
    attempts++;
    const randomIdx = startIdx + Math.floor(Math.random() * poolSize);
    const line = lines[randomIdx]?.trim();
    if (!line) continue;

    const parts = line.split(',');
    if (parts.length === 2) {
      const domain = parts[1].trim().toLowerCase();
      if (
        domain &&
        domain.includes('.') &&
        !TRANCO_SKIP_DOMAINS.has(domain) &&
        !domain.endsWith('.gov') &&
        !domain.endsWith('.edu')
      ) {
        selectedDomains.add(domain);
      }
    }
  }

  const result = [...selectedDomains];
  console.log(`[Tranco Fallback] Sampled ${result.length} random domains.`);
  return { domains: result, sources: { tranco: result.length } };
}

// ==========================================
// COMBINED DISCOVERY (public API)
// ==========================================

export type DiscoveryResult = {
  domains: string[];
  sources: { apify?: number; tranco?: number; bucket?: string };
};

/**
 * Discover candidate domains for the analysis pipeline.
 *
 * If APIFY_API_TOKEN is configured, uses Apify's Google Search Scraper to
 * find sites with confirmed legacy tech fingerprints — producing high-quality,
 * targeted leads. Falls back to random Tranco sampling only when Apify is
 * unavailable or throws.
 *
 * @param _tech - Ignored (legacy parameter, kept for call-site compatibility)
 * @param maxResults - Max domains to return
 */
export async function discoverLeads(
  _tech: string,
  maxResults = 50
): Promise<DiscoveryResult> {
  if (isApifyConfigured()) {
    try {
      const result = await discoverLeadsViaApify(maxResults);
      return {
        domains: result.domains,
        sources: { apify: result.sources.apify, bucket: result.sources.bucket },
      };
    } catch (err) {
      console.error('[Discovery] Apify discovery failed — falling back to Tranco:', err);
    }
  } else {
    console.warn('[Discovery] APIFY_API_TOKEN not set. Using Tranco fallback (low quality).');
  }

  return discoverViaTrancoPollback(maxResults);
}
