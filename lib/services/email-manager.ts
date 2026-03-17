import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { Company } from '../models';
import type { ContactDraft } from '../types';

/**
 * Email Manager - Handles outgoing SMTP and incoming IMAP reply tracking
 */
export class EmailManager {
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
        from: `"${process.env.EMAIL_FROM_NAME || 'Outreach Assistant'}" <${process.env.GMAIL_SMTP_IMAP_ACCOUNT}>`,
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

    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: process.env.GMAIL_SMTP_IMAP_ACCOUNT || '',
        pass: process.env.GMAIL_SMTP_IMAP_APP_PASSWORD || '',
      },
      logger: false,
    });

    let repliesFound = 0;

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      
      try {
        // Fetch messages from the last 7 days (simplified query)
        // Note: IMAP search queries are strings. 'SINCE 12-Mar-2024'
        const date = new Date();
        date.setDate(date.getDate() - 7);
        const sinceStr = date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
        
        for await (const message of client.fetch({ seen: false }, { envelope: true, source: true })) {
          if (!message.envelope) continue;

          const fromEmail = message.envelope.from?.[0]?.address?.toLowerCase();
          if (!fromEmail) continue;

          const subject = (message.envelope.subject || '').toLowerCase();
          const body = Buffer.isBuffer(message.source)
            ? message.source.toString('utf8')
            : String(message.source || '');

          const bouncedRecipient = this.extractBouncedRecipient(fromEmail, subject, body);
          if (bouncedRecipient) {
            const bouncedCompany = await Company.findOne({ 'contacts.email': bouncedRecipient });
            if (bouncedCompany) {
              const bouncedContact = bouncedCompany.contacts.find((c: any) => c.email?.toLowerCase() === bouncedRecipient);
              if (bouncedContact) {
                bouncedContact.deliveryStatus = 'bounced';
                bouncedContact.verificationStatus = 'invalid';
                const hasSendableContact = bouncedCompany.contacts.some((c: any) =>
                  c.email && c.verificationStatus === 'verified' && c.emailProviderVerified === true && c.deliveryStatus !== 'bounced'
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
      } finally {
        lock.release();
      }

      await client.logout();
    } catch (error) {
      console.error('❌ IMAP sync failed:', error);
    }

    return repliesFound;
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
