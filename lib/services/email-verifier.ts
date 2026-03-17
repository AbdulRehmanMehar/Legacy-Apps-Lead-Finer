import dns from 'dns';
import net from 'net';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);

// Cache MX lookups for the duration of the process — same domain appears
// on every contact within a company, no need to re-query DNS each time.
const mxCache = new Map<string, string>();

export interface VerificationResult {
  isValid: boolean;
  status: 'verified' | 'invalid' | 'catch_all' | 'unknown';
  error?: string;
}

/**
 * Validates an email address using MX record lookup and SMTP handshake.
 */
export async function verifyEmail(email: string): Promise<VerificationResult> {
  // 1. Basic Syntax Check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { isValid: false, status: 'invalid', error: 'Invalid syntax' };
  }

  const [, domain] = email.split('@');
  console.log(`   [verifier] Domain: ${domain}`);

  try {
    // 2. MX Record Lookup (cached per domain)
    let bestMx = mxCache.get(domain);
    if (!bestMx) {
      console.log(`   [verifier] Resolving MX for ${domain}...`);
      const mxRecords = await resolveMx(domain).catch((e) => {
        console.error(`   [verifier] DNS Error: ${e.message}`);
        return [];
      });

      if (mxRecords.length === 0) {
        return { isValid: false, status: 'invalid', error: 'No MX records found' };
      }

      bestMx = mxRecords.sort((a, b) => a.priority - b.priority)[0].exchange;
      mxCache.set(domain, bestMx);
      console.log(`   [verifier] Best MX: ${bestMx}`);
    } else {
      console.log(`   [verifier] MX cache hit for ${domain}: ${bestMx}`);
    }

    // 3. SMTP Handshake
    return await smtpCheck(bestMx, email, domain);
  } catch (err) {
    console.error(`   [verifier] Fatal Error:`, err);
    return { isValid: false, status: 'unknown', error: (err as Error).message };
  }
}

/**
 * Performs a non-invasive SMTP handshake to verify recipient existence.
 */
async function smtpCheck(mxHost: string, email: string, domain: string): Promise<VerificationResult> {
  console.log(`   [smtp] Connecting to ${mxHost}:25 (IPv4 forced)...`);
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: 25, host: mxHost, family: 4 });
    let step = 0;
    let resolved = false;

    socket.setTimeout(5000);

    const finish = (result: VerificationResult) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      console.log(`   [smtp] Result: ${result.status} (Valid: ${result.isValid}) ${result.error || ''}`);
      resolve(result);
    };

    socket.on('connect', () => {
      console.log(`   [smtp] TCP Connection established.`);
    });

    socket.on('lookup', (err, address) => {
      if (err) console.error(`   [smtp] DNS Lookup Error: ${err.message}`);
      else console.log(`   [smtp] Resolved MX host to: ${address}`);
    });

    socket.on('data', (data) => {
      const response = data.toString();
      const lines = response.split('\r\n').filter(l => l.trim());
      const lastLine = lines[lines.length - 1];
      const code = lastLine.substring(0, 3);
      
      console.log(`   [smtp] <-- ${lastLine.trim()}`);

      // 5xx = permanent rejection → invalid
      // 4xx = temporary rejection (greylisting, rate-limit) → unknown, not invalid
      if (code.startsWith('5') && step < 4) {
        return finish({ isValid: false, status: 'invalid', error: `SMTP ${code}: ${lastLine.trim()}` });
      }
      if (code.startsWith('4') && step < 4) {
        return finish({ isValid: false, status: 'unknown', error: `SMTP ${code} (temp): ${lastLine.trim()}` });
      }

      switch (step) {
        case 0: // Banner received -> Send HELO
          console.log(`   [smtp] --> HELO ${domain}`);
          socket.write(`HELO ${domain}\r\n`);
          step++;
          break;
        case 1: // HELO response -> Send MAIL FROM
          console.log(`   [smtp] --> MAIL FROM:<verify@antigravity.ai>`);
          socket.write(`MAIL FROM:<verify@antigravity.ai>\r\n`);
          step++;
          break;
        case 2: // MAIL FROM response -> Send RCPT TO (Target)
          console.log(`   [smtp] --> RCPT TO:<${email}>`);
          socket.write(`RCPT TO:<${email}>\r\n`);
          step++;
          break;
        case 3: // RCPT TO (Target) response -> Send RCPT TO (Random) to check catch-all
          if (code !== '250') {
            return finish({ isValid: false, status: 'invalid', error: `Recipient rejected: ${lastLine.trim()}` });
          }
          const randomEmail = `catchall-test-${Date.now()}@${domain}`;
          console.log(`   [smtp] --> RCPT TO:<${randomEmail}> (Catch-all check)`);
          socket.write(`RCPT TO:<${randomEmail}>\r\n`);
          step++;
          break;
        case 4: // RCPT TO (Random) response -> Finalize
          if (code === '250') {
            // Both target and random were accepted -> Catch-all
            finish({ isValid: true, status: 'catch_all' });
          } else {
            // Target was 250, but random was rejected -> Verified!
            finish({ isValid: true, status: 'verified' });
          }
          break;
      }
    });

    socket.on('error', (err) => {
      console.error(`   [smtp] Socket Error:`, err);
      finish({ isValid: false, status: 'unknown', error: err.message || 'Unknown Socket Error' });
    });

    socket.on('timeout', () => {
      console.error(`   [smtp] Connection Timeout`);
      finish({ isValid: false, status: 'unknown', error: 'SMTP Timeout' });
    });

    socket.on('close', (hadError) => {
      if (!resolved) {
        console.log(`   [smtp] Connection closed by server.`);
        finish({ isValid: false, status: 'unknown', error: 'Connection closed' });
      }
    });
  });
}
