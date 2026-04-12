import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { Company } from '../models';
import { canSendOutreachToContact } from '../utils';
import type { ContactDraft } from '../types';

/**
 * Email Manager - Handles outgoing SMTP and incoming IMAP reply tracking
 */
export class EmailManager {
  private static lastProcessedImapUid = 0;
  private static replySyncBackoffUntil = 0;
  private static consecutiveReplySyncFailures = 0;
  private static readonly MAX_IMAP_MESSAGES_PER_RUN = 25;
  private static readonly IMAP_SYNC_LOOKBACK_DAYS = 7;

  private static transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // Use SSL
    auth: {
      user: process.env.GMAIL_SMTP_IMAP_ACCOUNT || '',
      pass: process.env.GMAIL_SMTP_IMAP_APP_PASSWORD || '',
    },
  });

  /**
   * Sends an email draft to a contact
   */
  static async sendEmail(to: string, draft: ContactDraft): Promise<boolean> {
    if (!process.env.GMAIL_SMTP_IMAP_ACCOUNT) {
      console.warn('⚠️ GMAIL_SMTP_IMAP_ACCOUNT not configured. Skipping email send.');
      return false;
    }

    try {
      const info = await this.transporter.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME || 'Abdul Rehman'}" <${process.env.GMAIL_SMTP_IMAP_ACCOUNT}>`,
        to,
        subject: draft.subject,
        text: draft.body,
      });

      console.log(`✅ Email sent to ${to}: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to send email to ${to}:`, error);
      throw error;
    }
  }

  /**
   * Sync replies from IMAP
   * This is a simplified version - in a real app, this would run as a background task
   */
  static async syncReplies(): Promise<number> {
    if (!process.env.GMAIL_SMTP_IMAP_ACCOUNT || !process.env.GMAIL_SMTP_IMAP_APP_PASSWORD) {
      console.warn('⚠️ GMAIL_SMTP_IMAP_ACCOUNT / GMAIL_SMTP_IMAP_APP_PASSWORD not configured. Skipping reply sync.');
      return 0;
    }

    if (Date.now() < this.replySyncBackoffUntil) {
      const minutesRemaining = Math.ceil((this.replySyncBackoffUntil - Date.now()) / (60 * 1000));
      console.warn(`⚠️ IMAP sync cooling down for ${minutesRemaining} more minute(s) after provider throttling.`);
      return 0;
    }

    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: process.env.GMAIL_SMTP_IMAP_ACCOUNT || '',
        pass: process.env.GMAIL_SMTP_IMAP_APP_PASSWORD || '',
      },
      logger: false,
      // Without these, a stalled TCP connection hangs indefinitely and
      // eventually throws AggregateError: ETIMEDOUT with no backoff applied.
      socketTimeout: 20000,     // abort if socket is idle for 20s
      connectionTimeout: 10000, // abort if the initial TLS handshake takes > 10s
    } as any);

    let repliesFound = 0;
    let highestUidSeen = this.lastProcessedImapUid;

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      
      try {
        const date = new Date();
        date.setDate(date.getDate() - this.IMAP_SYNC_LOOKBACK_DAYS);

        const searchQuery: { since: Date; uid?: string } = { since: date };
        if (this.lastProcessedImapUid > 0) {
          searchQuery.uid = `${this.lastProcessedImapUid + 1}:*`;
        }

        const matchingUids = ((await client.search(searchQuery, { uid: true })) || [])
          .map((uid) => Number(uid))
          .filter((uid) => Number.isFinite(uid) && uid > 0)
          .sort((left, right) => left - right)
          .slice(0, this.MAX_IMAP_MESSAGES_PER_RUN);

        if (matchingUids.length === 0) {
          this.consecutiveReplySyncFailures = 0;
          return 0;
        }

        for (const uid of matchingUids) {
          const message = await client.fetchOne(String(uid), { uid: true, envelope: true }, { uid: true });
          if (!message || !message.envelope) continue;

          highestUidSeen = Math.max(highestUidSeen, message.uid || uid);

          const fromEmail = message.envelope.from?.[0]?.address?.toLowerCase();
          if (!fromEmail) continue;

          const subject = (message.envelope.subject || '').toLowerCase();
          const likelyBounce = /mailer-daemon|postmaster|mail delivery subsystem|no-reply/i.test(fromEmail)
            || /delivery status notification|undeliverable|returned mail|delivery failure|mail delivery failed/i.test(subject);

          if (likelyBounce) {
            const fullMessage = await client.fetchOne(String(uid), { source: true }, { uid: true });
            if (!fullMessage) {
              continue;
            }

            const body = Buffer.isBuffer(fullMessage.source)
              ? fullMessage.source.toString('utf8')
              : String(fullMessage.source || '');
            const bouncedRecipient = this.extractBouncedRecipient(fromEmail, subject, body);

            if (!bouncedRecipient) {
              continue;
            }

            const bouncedCompany = await Company.findOne({ 'contacts.email': bouncedRecipient });
            if (bouncedCompany) {
              const bouncedContact = bouncedCompany.contacts.find((c: any) => c.email?.toLowerCase() === bouncedRecipient);
              if (bouncedContact) {
                bouncedContact.deliveryStatus = 'bounced';
                bouncedContact.verificationStatus = 'invalid';
                const hasSendableContact = bouncedCompany.contacts.some((c: any) =>
                  canSendOutreachToContact(c)
                );
                if (!hasSendableContact && ['needs_drafts', 'drafts_ready', 'contacted'].includes(bouncedCompany.status)) {
                  bouncedCompany.status = 'needs_verified_contacts';
                }
                await bouncedCompany.save();
                console.log(`📪 Bounce detected for ${bouncedRecipient} (${bouncedCompany.domain})`);
              }
            }
            continue;
          }

          // Check if this email belongs to a lead we've contacted
          const company = await Company.findOne({ 'contacts.email': fromEmail });
          if (company) {
            const contactIndex = company.contacts.findIndex((c: any) => c.email === fromEmail);
            if (contactIndex > -1) {
              const contact = company.contacts[contactIndex];
              if (!contact.has_replied) {
                contact.has_replied = true;
                contact.last_reply_at = message.envelope.date;
                await company.save();
                repliesFound++;
                console.log(`📩 New reply detected from ${fromEmail} (${company.domain})`);
              }
            }
          }
        }

        this.lastProcessedImapUid = highestUidSeen;
        this.consecutiveReplySyncFailures = 0;
        this.replySyncBackoffUntil = 0;
      } finally {
        lock.release();
      }

    } catch (error) {
      if (highestUidSeen > this.lastProcessedImapUid) {
        this.lastProcessedImapUid = highestUidSeen;
      }

      this.consecutiveReplySyncFailures += 1;
      if (this.isImapRateLimitError(error)) {
        const baseBackoffMinutes = 15;
        const multiplier = Math.min(this.consecutiveReplySyncFailures, 4);
        const backoffMinutes = baseBackoffMinutes * multiplier;
        this.replySyncBackoffUntil = Date.now() + backoffMinutes * 60 * 1000;
        console.warn(`⚠️ IMAP provider throttled the account. Backing off for ${backoffMinutes} minute(s).`);
      }

      console.error('❌ IMAP sync failed:', error);
    } finally {
      try {
        await client.logout();
      } catch {
        // Ignore disconnect errors during shutdown/throttle conditions.
      }
    }

    return repliesFound;
  }

  private static isImapRateLimitError(error: unknown): boolean {
    const candidate = error as { code?: string; reason?: string; message?: string; errors?: unknown[] } | null;
    const haystack = `${candidate?.code || ''} ${candidate?.reason || ''} ${candidate?.message || ''}`.toLowerCase();
    // Flatten AggregateError sub-errors into the haystack so ETIMEDOUT is caught.
    const subErrors = Array.isArray(candidate?.errors)
      ? candidate.errors.map((e: any) => `${e?.code || ''} ${e?.message || ''}`).join(' ')
      : '';
    const full = `${haystack} ${subErrors}`.toLowerCase();
    return full.includes('bandwidth limits')
      || full.includes('command limits')
      || full.includes('account exceeded')
      || full.includes('noconnection')
      || full.includes('etimedout')
      || full.includes('econnrefused')
      || full.includes('econnreset')
      || full.includes('enotfound');
  }

  private static extractBouncedRecipient(fromEmail: string, subject: string, body: string): string | null {
    const bounceSender = /mailer-daemon|postmaster|mail delivery subsystem|no-reply/i.test(fromEmail);
    const bounceSubject = /delivery status notification|undeliverable|returned mail|delivery failure|mail delivery failed/i.test(subject);

    if (!bounceSender && !bounceSubject) {
      return null;
    }

    const matches = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    for (const match of matches) {
      const candidate = match.toLowerCase();
      if (candidate !== fromEmail && !candidate.includes('mailer-daemon') && !candidate.includes('postmaster')) {
        return candidate;
      }
    }

    return null;
  }
}
