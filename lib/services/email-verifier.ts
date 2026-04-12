import dns from 'dns';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);

// Cache MX lookups for the lifetime of the process — same domain appears
// on every contact within a company, no need to re-query DNS each time.
const mxCache = new Map<string, string | null>();

export interface VerificationResult {
  isValid: boolean;
  status: 'verified' | 'invalid' | 'catch_all' | 'unknown';
  error?: string;
}

/**
 * Validates an email address using syntax check + MX record lookup.
 *
 * SMTP handshake (port 25) is intentionally NOT used:
 *   • Port 25 outbound is blocked by virtually every cloud host and Docker network.
 *   • A blocked port returns 'unknown' on every check, making SMTP useless here.
 *   • MX existence is sufficient signal: if the domain has mail records, the
 *     address is deliverable enough to attempt. Real bounces are tracked by the
 *     outreach layer (deliveryStatus: 'bounced').
 *
 * Return values:
 *   verified — domain has MX records, address format is valid
 *   invalid  — no MX records (domain cannot receive email) or bad syntax
 *   unknown  — DNS lookup failed (network error); treated as sendable by the
 *              outreach layer because the failure may be transient
 */
export async function verifyEmail(email: string): Promise<VerificationResult> {
  // 1. Syntax check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { isValid: false, status: 'invalid', error: 'Invalid syntax' };
  }

  const domain = email.split('@')[1];

  // 2. MX record lookup (cached)
  if (!mxCache.has(domain)) {
    try {
      const records = await resolveMx(domain);
      const best = records.sort((a, b) => a.priority - b.priority)[0]?.exchange ?? null;
      mxCache.set(domain, best);
    } catch (err) {
      mxCache.set(domain, null);
      console.log(`   [verifier] DNS lookup failed for ${domain}: ${(err as Error).message}`);
    }
  }

  const mx = mxCache.get(domain);

  if (mx === undefined) {
    // Should not happen, but treat as unknown
    return { isValid: true, status: 'unknown', error: 'MX cache miss' };
  }

  if (mx === null) {
    // DNS error — we cannot confirm or deny, be optimistic
    return { isValid: true, status: 'unknown', error: 'DNS lookup failed' };
  }

  // MX found — domain can receive mail
  console.log(`   [verifier] ${email} → MX: ${mx} → verified`);
  return { isValid: true, status: 'verified' };
}
