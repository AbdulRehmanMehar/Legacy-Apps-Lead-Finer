import { Company } from '../models';
import { EmailManager } from './email-manager';
import { generateFollowupEmail } from './ollama';
import { canSendOutreachToContact } from '../utils';

/**
 * OutreachAgent - The autonomous "brain" for lead engagement.
 * Manages initial outreach and automated follow-up sequences.
 */
export class OutreachAgent {
  private static FOLLOW_UP_DELAY_DAYS = 3;

  /**
   * Main engagement loop - intended to be called by Stage 5 of the pipeline
   */
  static async runEngagementTick() {
    console.log('🤖 [OutreachAgent] Starting engagement tick...');
    
    // 1. Initial Outreach (Step 1)
    const initialSent = await this.processInitialOutreach();
    
    // 2. Follow-ups (Step 2)
    const followUpsSent = await this.processFollowUps();

    return { initialSent, followUpsSent };
  }

  /**
   * Identifies leads ready for first contact and sends initial draft
   */
  private static async processInitialOutreach(): Promise<number> {
    const company = await Company.findOneAndUpdate(
      { status: 'drafts_ready' },
      { $set: { status: 'sending_outreach' } },
      { returnDocument: 'after' }
    );

    if (!company) return 0;

    let sent = 0;
    for (const contact of company.contacts) {
      const draft = contact.drafts.find((d: any) => d.type === 'initial' && !d.sent_at);
      if (draft && canSendOutreachToContact(contact)) {
        try {
          const success = await EmailManager.sendEmail(contact.email, draft);
          if (success) {
            draft.sent_at = new Date();
            contact.deliveryStatus = 'sent';
            sent++;
            break; // One email per company per run
          }
        } catch (e) {
          console.error(`❌ [OutreachAgent] Initial send failed for ${contact.fullName}:`, e);
        }
      }
    }

    company.status = sent > 0 ? 'contacted' : 'drafts_ready';
    await company.save();
    return sent;
  }

  /**
   * Identifies contacted leads that haven't replied and sends follow-up sequences
   */
  private static async processFollowUps(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.FOLLOW_UP_DELAY_DAYS);

    // Find companies contacted over N days ago that haven't replied
    const companies = await Company.find({
      status: 'contacted',
      'contacts.has_replied': { $ne: true },
      'contacts.drafts.sent_at': { $lte: cutoffDate }
    }).limit(3);

    let totalFollowUps = 0;

    for (const company of companies) {
      for (const contact of company.contacts) {
        if (contact.has_replied) continue;
        if (!canSendOutreachToContact(contact)) {
          console.log(`   ⏭️ [OutreachAgent] Skipping follow-up for ${contact.fullName} (${contact.email || 'no email'}) — status: ${contact.verificationStatus}, delivery: ${contact.deliveryStatus}`);
          continue;
        }
        
        const initialDraft = contact.drafts.find((d: any) => d.type === 'initial' && d.sent_at);
        if (!initialDraft) continue;

        const followUpSent = contact.drafts.some((d: any) => d.type === 'follow-up' && d.sent_at);
        if (followUpSent) continue;

        // Check if we need to generate a follow-up
        let followUpDraft = contact.drafts.find((d: any) => d.type === 'follow-up' && !d.sent_at);
        
        if (!followUpDraft) {
          console.log(`🧠 [OutreachAgent] Generating follow-up for ${contact.fullName}...`);
          try {
            const generated = await generateFollowupEmail(
              {
                firstName: contact.firstName,
                lastName: contact.lastName,
                title: contact.title || 'Decision Maker',
                company: company.name || company.domain,
              },
              {
                subject: initialDraft.subject,
                body: initialDraft.body,
                sentAt: initialDraft.sent_at!,
              },
              1
            );
            
            contact.drafts.push({
              subject: generated.subject,
              body: generated.body,
              type: 'follow-up',
              created_at: new Date(),
            } as any);
            
            await company.save();
            followUpDraft = contact.drafts[contact.drafts.length - 1];
          } catch (genErr) {
            console.error(`❌ [OutreachAgent] Follow-up generation failed:`, genErr);
            continue;
          }
        }

        // Send the follow-up
        if (followUpDraft) {
          try {
            console.log(`📧 [OutreachAgent] Sending follow-up #1 to ${contact.fullName}...`);
            const success = await EmailManager.sendEmail(contact.email, followUpDraft);
            if (success) {
              followUpDraft.sent_at = new Date();
              contact.deliveryStatus = 'sent';
              await company.save();
              totalFollowUps++;
              break; // Limit to one follow-up per company per tick
            }
          } catch (sendErr) {
            console.error(`❌ [OutreachAgent] Follow-up send failed:`, sendErr);
          }
        }
      }
    }

    return totalFollowUps;
  }
}
