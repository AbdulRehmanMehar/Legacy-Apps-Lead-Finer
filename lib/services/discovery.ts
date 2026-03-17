import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Autonomous Lead Discovery Service
 * Uses the free Tranco Top 1 Million list to seed the pipeline with active 
 * domains. Stage 2 (Analyzer) will visit these and check if they run legacy tech.
 * This completely avoids API keys, bot protections, and rate-limits.
 */

// ==========================================
// TECH SIGNATURE REGISTRY (kept for reference and typing)
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

const CACHE_DIR = path.join(os.tmpdir(), 'legacy-leads-discovery');
const CSV_PATH = path.join(CACHE_DIR, 'top-1m.csv');

function ensureTrancoList() {
  if (fs.existsSync(CSV_PATH)) {
    const stats = fs.statSync(CSV_PATH);
    const ageDays = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageDays < 7) {
      return; // Use cached version for 7 days
    }
  }
  
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  console.log(`   ⬇️ [Tranco] Downloading latest Top 1M domains list...`);
  const zipPath = path.join(CACHE_DIR, 'top-1m.zip');
  
  try {
    execSync(`curl -sL "https://tranco-list.eu/top-1m.csv.zip" > "${zipPath}"`);
    execSync(`unzip -p "${zipPath}" > "${CSV_PATH}"`);
    fs.unlinkSync(zipPath);
    console.log(`   ✅ [Tranco] Downloaded and extracted successfully.`);
  } catch (error) {
    console.error(`   ❌ [Tranco] Error fetching list:`, error);
    // If it fails, create a tiny fallback list so it doesn't crash on first run without internet
    if (!fs.existsSync(CSV_PATH)) {
      fs.writeFileSync(CSV_PATH, "1,example.com\n2,test.com\n");
    }
  }
}

// ==========================================
// COMBINED DISCOVERY
// ==========================================
export async function discoverLeads(
  tech: string, // Kept for signature compatibility
  maxResults = 50
): Promise<{ domains: string[]; sources: { tranco: number } }> {
  ensureTrancoList();
  
  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = content.split('\n');
  
  // Ensure we have enough lines
  if (lines.length < 100000) {
     return { domains: [], sources: { tranco: 0 }};
  }
  
  // Skip top 100,000 domains since they are likely huge enterprises rather than legacy leads
  const startIdx = 100000;
  const endIdx = lines.length - 1;
  const poolSize = endIdx - startIdx;
  
  const selectedDomains = new Set<string>();
  
  // Random sampling with basic domain sanity check
  const SKIP_DOMAINS = new Set([
    'facebook.com', 'twitter.com', 'x.com', 'linkedin.com', 'instagram.com',
    'youtube.com', 'github.com', 'npmjs.com', 'stackoverflow.com',
    'wikipedia.org', 'medium.com', 'reddit.com', 'amazon.com', 'google.com',
    'bing.com', 'cloudflare.com', 'wordpress.org', 'drupal.org', 'joomla.org',
  ]);

  let attempts = 0;
  while (selectedDomains.size < maxResults && attempts < maxResults * 10) {
    attempts++;
    const randomIdx = startIdx + Math.floor(Math.random() * poolSize);
    const line = lines[randomIdx]?.trim();
    if (!line) continue;
    
    // Line format: "1234,example.com"
    const parts = line.split(',');
    if (parts.length === 2) {
      const domain = parts[1].trim().toLowerCase();
      if (
        domain && 
        domain.includes('.') && 
        !SKIP_DOMAINS.has(domain) &&
        !domain.endsWith('.gov') &&
        !domain.endsWith('.edu')
      ) {
        selectedDomains.add(domain);
      }
    }
  }
  
  const result = [...selectedDomains];
  console.log(`🎯 [Discovery] Sampled ${result.length} random business domains from Tranco.`);
  
  return {
    domains: result,
    sources: { tranco: result.length },
  };
}
