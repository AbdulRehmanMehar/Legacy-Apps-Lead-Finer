import dns from 'dns';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);

/**
 * Generates candidate email addresses for a person at a company domain.
 * Used as a fallback when RocketReach doesn't have email data.
 */

const COMMON_PATTERNS = [
  // Most common corporate patterns (ordered by prevalence)
  (first: string, last: string) => `${first}@`,                          // john@
  (first: string, last: string) => `${first}.${last}@`,                  // john.smith@
  (first: string, last: string) => `${first[0]}${last}@`,                // jsmith@
  (first: string, last: string) => `${first}${last}@`,                   // johnsmith@
  (first: string, last: string) => `${first[0]}.${last}@`,               // j.smith@
  (first: string, last: string) => `${first}_${last}@`,                  // john_smith@
  (first: string, last: string) => `${last}@`,                           // smith@
  (first: string, last: string) => `${first}${last[0]}@`,                // johns@
];

/**
 * Generate candidate emails for a person at a domain.
 * Returns the candidates sorted by likelihood (most common pattern first).
 */
export function generateCandidateEmails(
  firstName: string,
  lastName: string,
  domain: string
): string[] {
  const first = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const last = lastName.toLowerCase().replace(/[^a-z]/g, '');

  if (!first || !last) return [];

  return COMMON_PATTERNS.map(pattern => `${pattern(first, last)}${domain}`);
}

/**
 * Check if a domain has MX records (i.e., can receive email).
 * Caches results so we don't re-lookup for every candidate.
 */
const mxCache = new Map<string, boolean>();

async function domainHasMx(domain: string): Promise<boolean> {
  if (mxCache.has(domain)) return mxCache.get(domain)!;

  try {
    const records = await resolveMx(domain);
    const hasMx = records.length > 0;
    mxCache.set(domain, hasMx);
    return hasMx;
  } catch {
    mxCache.set(domain, false);
    return false;
  }
}

/**
 * Guess the most likely email for a person at a company domain.
 * 
 * Strategy:
 * 1. Verify the domain accepts email (MX records exist)
 * 2. Return candidates ordered by common corporate pattern prevalence
 * 
 * The first candidate (first@domain) is the single best guess — 
 * SMTP verification can be done later if needed.
 */
export async function guessEmail(
  firstName: string,
  lastName: string,
  domain: string
): Promise<{ email: string; pattern: string } | null> {
  if (!firstName || !lastName || !domain) return null;

  const hasMx = await domainHasMx(domain);
  if (!hasMx) {
    console.log(`   [guesser] ${domain} has no MX records — skipping email guess.`);
    return null;
  }

  const candidates = generateCandidateEmails(firstName, lastName, domain);
  if (candidates.length === 0) return null;

  // Return the first (most common) pattern
  const bestGuess = candidates[0];
  console.log(`   [guesser] Best guess for ${firstName} ${lastName} @ ${domain}: ${bestGuess}`);
  return { email: bestGuess, pattern: 'first@domain' };
}
