import cron from 'node-cron';
import dbConnect from '../mongodb';
import { Company, AnalysisQueueItem } from '../models';
import { analyzeCompany, formatAnalysisForStorage } from '../services/company-analyzer';
import { discoverLeads, TECH_LIST } from '../services/discovery';
import { preflightFilter } from '../services/domain-preflight';
import { searchPeopleAtCompany, lookupPerson } from '../services/rocketreach';
import { generateInitialEmail, enrichCompanyProfile } from '../services/ollama';
import { verifyEmail } from '../services/email-verifier';
import { EmailManager } from '../services/email-manager';
import { OutreachAgent } from '../services/outreach-agent';
import { canSendOutreachToContact, hasVerifiedOutreachContact, isPersonalEmailDomain } from '../utils';

// ==========================================
// CONSTANTS
// ==========================================
let techRotationIndex = 0;

const MAX_STUCK_MINUTES = 15;   // For stages 1, 2
const MAX_STUCK_DRAFTING = 5;   // Stage 4 — Ollama is fast, 5 min is enough
const MAX_RETRIES = 3;          // Queue item retries before permanent failure
const MAX_CONTACT_RETRIES = 5;  // Company-level contact-fetch retries before giving up
const STAGE1_SEED_BATCH_SIZE = 50;
const STAGE1_LOW_WATERMARK = 10;

// Exponential back-off delays per retry attempt (minutes)
const BACKOFF_DELAYS_MINUTES = [0, 5, 30]; // attempt 1 = immediate, 2 = 5m, 3 = 30m

// ==========================================
// PER-STAGE CRON OVERLAP GUARDS
// Prevents two cron instances from running the same stage simultaneously
// ==========================================
const stageRunning: Record<string, boolean> = {
  stage1: false,
  stage2: false,
  stage3: false,
  stage4: false,
  stage5: false,
};

let triggerStage1LowWatermarkRefill: null | (() => Promise<any>) = null;

function withStageLock(stageName: string, fn: () => Promise<any>) {
  return async () => {
    if (stageRunning[stageName]) {
      console.log(`⏭️  [${stageName.toUpperCase()}] Previous run still active — skipping this tick.`);
      return;
    }
    stageRunning[stageName] = true;
    try {
      await fn();
    } finally {
      stageRunning[stageName] = false;
    }
  };
}

// ==========================================
// DB CONNECT WITH RETRY
// ==========================================
async function connectWithRetry() {
  try {
    await dbConnect();
  } catch (err) {
    console.warn('[db] Initial dbConnect failed, retrying in 2s...');
    await new Promise(r => setTimeout(r, 2000));
    await dbConnect(); // Second attempt — let it throw if it fails again
  }
}

async function countPendingQueueItems() {
  return AnalysisQueueItem.countDocuments({ status: 'pending' });
}

// ==========================================
// STAGE 1 — Discovery / Scraping
// ==========================================
export async function processStage1Scraping(trigger: 'startup' | 'scheduled' | 'low-watermark' = 'scheduled') {
  console.log(`⏳ [STAGE 1] Running Legacy Leads Discovery (${trigger})...`);
  try {
    await connectWithRetry();

    const pendingCount = await countPendingQueueItems();
    if (pendingCount >= STAGE1_LOW_WATERMARK) {
      console.log(`ℹ️  [STAGE 1] Skipping seed. Pending queue already has ${pendingCount} item(s).`);
      return { success: true, count: 0, skipped: true, pendingCount, trigger };
    }

    const targetTech = TECH_LIST[techRotationIndex % TECH_LIST.length];
    techRotationIndex++;

    const sourceLabel = process.env.APIFY_API_TOKEN ? 'Apify Google Search' : 'Tranco Fallback';
    console.log(`🤖 [STAGE 1] Seeding pipeline with up to ${STAGE1_SEED_BATCH_SIZE} domains via ${sourceLabel}`);
    const { domains, sources } = await discoverLeads("any", STAGE1_SEED_BATCH_SIZE);
    const sourcesSummary = sources.apify != null
      ? `Apify=${sources.apify} (bucket: ${sources.bucket})`
      : `Tranco=${sources.tranco}`;
    console.log(`   Sources: ${sourcesSummary}`);

    if (domains.length === 0) {
      return { success: true, count: 0, tech: 'any', sources };
    }

    // Batch-check existing domains to avoid N+1 queries
    const existingQueued = new Set(
      (await AnalysisQueueItem.find({ domain: { $in: domains } }).select('domain')).map(
        (d: any) => d.domain
      )
    );
    const existingCompanies = new Set(
      (await Company.find({ domain: { $in: domains } }).select('domain')).map(
        (c: any) => c.domain
      )
    );

    const dedupedDomains = domains.filter(
      d => !existingQueued.has(d) && !existingCompanies.has(d)
    );

    // Pre-flight: drop dead sites, modern hosted platforms, and parked domains
    // before they waste a Puppeteer slot in Stage 2.
    const newDomains = dedupedDomains.length > 0
      ? await preflightFilter(dedupedDomains)
      : [];

    if (newDomains.length > 0) {
      await AnalysisQueueItem.insertMany(
        newDomains.map(domain => ({ company_id: 'auto-generated', domain, status: 'pending' })),
        { ordered: false }
      );
    }

    console.log(`✅ [STAGE 1] Queued ${newDomains.length} new domains (${dedupedDomains.length - newDomains.length} filtered by preflight).`);
    return { success: true, count: newDomains.length, tech: targetTech, sources, trigger };
  } catch (error) {
    console.error('❌ [STAGE 1] Discovery Error:', error);
    return { success: false, error: (error as Error).message };
  }
}

// ==========================================
// STAGE 2 — Tech Stack & Enrichment Analysis
// ==========================================
export async function processStage2Analysis() {
  try {
    await connectWithRetry();

    const now = new Date();
    const stuckCutoff = new Date(Date.now() - MAX_STUCK_MINUTES * 60 * 1000);

    // Reset items stuck in 'processing' longer than MAX_STUCK_MINUTES
    await AnalysisQueueItem.updateMany(
      { status: 'processing', updated_at: { $lt: stuckCutoff }, retry_count: { $lt: MAX_RETRIES } },
      { $set: { status: 'pending' }, $inc: { retry_count: 1 } }
    );
    await AnalysisQueueItem.updateMany(
      { status: 'processing', updated_at: { $lt: stuckCutoff }, retry_count: { $gte: MAX_RETRIES } },
      { $set: { status: 'failed', error: 'Max retries exceeded' } }
    );

    // Atomically claim the oldest pending item that's past its backoff delay
    const item = await AnalysisQueueItem.findOneAndUpdate(
      {
        status: 'pending',
        $or: [
          { retry_delay_until: { $exists: false } },
          { retry_delay_until: null },
          { retry_delay_until: { $lte: now } },
        ],
      },
      { $set: { status: 'processing' } },
      { sort: { created_at: 1 }, returnDocument: 'after' }
    );
    if (!item) {
      console.log('ℹ️  [STAGE 2] No pending queue items.');
      if (triggerStage1LowWatermarkRefill) {
        await triggerStage1LowWatermarkRefill();
      } else {
        await processStage1Scraping('low-watermark');
      }
      return { success: true, message: 'No pending items' };
    }

    console.log(`⏳ [STAGE 2] Analyzing domain tech stack: ${item.domain}`);

    try {
      const analysis = await analyzeCompany(item.domain, { skipPageSpeed: false, timeout: 60000 });
      const storageData = formatAnalysisForStorage(analysis);

      let company = await Company.findOne({ domain: item.domain });
      let nextStatus = storageData.is_legacy ? 'needs_contacts' : 'rejected';

      // Run AI Enrichment for legacy leads only (saves LLM tokens)
      let enrichmentData = undefined;
      if (storageData.is_legacy && storageData.pageText) {
        console.log(`   🧠 [STAGE 2] Enriching company profile for ${item.domain}...`);
        try {
          const result = await enrichCompanyProfile(storageData.pageText);
          if (result) enrichmentData = result;
        } catch (enrichErr) {
          console.error(`   ⚠️ [STAGE 2] Enrichment failed for ${item.domain}:`, enrichErr);
        }
      }

      // Mark unreachable ONLY if everything failed and there was a network error
      // If we have a PageSpeed score, the site was definitely reached.
      if (storageData.tech_stack.length === 0 && !storageData.pagespeed_score && storageData.last_error) {
        nextStatus = 'unreachable';
      }
      
      // If marked unreachable, ensure PageSpeed score doesn't show up
      if (nextStatus === 'unreachable') {
        storageData.pagespeed_score = null;
        storageData.pagespeed_data = null;
      }
      
      const companyName = company?.name || item.domain;

      if (company) {
        company.tech_stack = storageData.tech_stack as any;
        company.pagespeed_score = storageData.pagespeed_score ?? undefined;
        company.pagespeed_data = storageData.pagespeed_data ?? undefined;
        company.is_legacy = storageData.is_legacy;
        company.legacy_reasons = storageData.legacy_reasons;
        company.analyzed_at = storageData.analyzed_at as any;
        if (enrichmentData) company.enrichment = enrichmentData;
        if (storageData.screenshot_path) (company as any).screenshot_path = storageData.screenshot_path;
        (company as any).last_error = storageData.last_error;
        if (company.status === 'new' || company.status === 'analyzing') {
          company.status = nextStatus;
        }
        await company.save();
      } else {
        company = await Company.create({
          domain: item.domain,
          name: companyName,
          tech_stack: storageData.tech_stack,
          pagespeed_score: storageData.pagespeed_score ?? undefined,
          pagespeed_data: storageData.pagespeed_data ?? undefined,
          is_legacy: storageData.is_legacy,
          legacy_reasons: storageData.legacy_reasons,
          enrichment: enrichmentData,
          screenshot_path: storageData.screenshot_path,
          analyzed_at: storageData.analyzed_at,
          last_error: storageData.last_error,
          status: nextStatus,
        } as any);
      }

      item.status = 'completed';
      item.completed_at = new Date();
      await item.save();
      console.log(`✅ [STAGE 2] Done. Legacy=${storageData.is_legacy} → ${nextStatus}`);
      return { success: true, domain: item.domain, isLegacy: storageData.is_legacy, status: nextStatus };

    } catch (analysisError) {
      console.error(`❌ [STAGE 2] Failed to analyze ${item.domain}:`, analysisError);
      const newRetryCount = (item.retry_count || 0) + 1;
      item.retry_count = newRetryCount;

      if (newRetryCount >= MAX_RETRIES) {
        item.status = 'failed';
      } else {
        // Exponential back-off: wait 5 min on attempt 2, 30 min on attempt 3
        const delayMinutes = BACKOFF_DELAYS_MINUTES[newRetryCount] ?? 60;
        item.status = 'pending';
        (item as any).retry_delay_until = new Date(Date.now() + delayMinutes * 60 * 1000);
        console.log(`   ⏱️  Backing off ${delayMinutes}m before retry #${newRetryCount + 1}`);
      }

      item.error = analysisError instanceof Error ? analysisError.message : 'Unknown error';
      await item.save();
      return { success: false, domain: item.domain, error: (analysisError as Error).message };
    }
  } catch (error) {
    console.error('❌ [STAGE 2] Queue Processor Error:', error);
    return { success: false, error: (error as Error).message };
  }
}

// ==========================================
// STAGE 3 — Contact Fetching
// ==========================================
export async function processStage3Contacts() {
  try {
    await connectWithRetry();

    const stuckCutoff = new Date(Date.now() - MAX_STUCK_MINUTES * 60 * 1000);

    // Recover stuck fetching_contacts records
    await Company.updateMany(
      { status: 'fetching_contacts', updated_at: { $lt: stuckCutoff } },
      { $set: { status: 'needs_contacts' } }
    );

    // Claim a batch of up to 10 companies
    const companies = await Company.find({ status: 'needs_contacts' }).limit(10);
    if (companies.length === 0) {
      console.log('ℹ️  [STAGE 3] No companies currently need contacts.');
      return { success: true, message: 'No companies needing contacts' };
    }

    console.log(`⏳ [STAGE 3] Processing batch of ${companies.length} companies for contacts...`);

    const results = await Promise.all(companies.map(async (company) => {
      // Optimistically lock the record
      const locked = await Company.findOneAndUpdate(
        { _id: company._id, status: 'needs_contacts' },
        { $set: { status: 'fetching_contacts' } },
        { returnDocument: 'after' }
      );
      if (!locked) return null;

      try {
        const rrKey = process.env.ROCKETREACH_API_KEY;
        const searchName = locked.name || locked.domain;
        const res = await searchPeopleAtCompany(searchName, locked.domain, { limit: 5 });

        if (res.contacts && res.contacts.length > 0) {
          // Drop contacts with personal email domains before storing them.
          // RocketReach occasionally returns gmail/yahoo/etc. addresses for business
          // contacts — these are personal emails and will always bounce or be ignored.
          const validRRContacts = res.contacts.filter((c: any) => {
            if (c.email && isPersonalEmailDomain(c.email)) {
              console.log(`   ⚠️ [STAGE 3] Skipping personal email for ${c.fullName}: ${c.email}`);
              return false;
            }
            return true;
          });

          if (validRRContacts.length === 0) {
            // All contacts had personal emails — treat as no contacts found
            const retryCount = ((locked as any).contact_retry_count || 0) + 1;
            (locked as any).contact_retry_count = retryCount;
            locked.status = retryCount >= MAX_CONTACT_RETRIES ? 'rejected' : 'needs_contacts';
            locked.last_error = 'All RocketReach contacts had personal email domains (gmail/yahoo/etc.)';
            await locked.save();
            return { domain: locked.domain, count: 0 };
          }

          locked.contacts = validRRContacts.map((c: any) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            fullName: c.fullName,
            email: c.email,
            linkedinUrl: c.linkedinUrl,
            title: c.title,
            seniority: c.seniority,
            department: c.department,
            drafts: [],
            rocketreachId: c.rocketreachId,
            emailProviderVerified: c.emailVerified || false,
            deliveryStatus: 'unknown',
            verificationStatus: 'unknown'
          })) as any;

          // Process all contacts in parallel.
          await Promise.all(locked.contacts.map(async (contact: any) => {
            // RocketReach already verified this email — trust it directly.
            if (contact.email && contact.emailProviderVerified) {
              contact.verificationStatus = 'verified';
              console.log(`   ✅ [STAGE 3] ${contact.fullName}: RocketReach-verified email.`);
              return;
            }

            // No email yet — attempt a RocketReach lookup by ID.
            if (!contact.email && contact.rocketreachId) {
              console.log(`   🔍 [STAGE 3] Lookup for ${contact.fullName} (${locked.domain})...`);
              try {
                const detailedPerson = await lookupPerson(contact.rocketreachId);
                const verifiedEmail = detailedPerson?.emails?.find((e: any) => e.is_valid)?.email
                  ?? detailedPerson?.emails?.[0]?.email
                  ?? null;
                if (verifiedEmail) {
                  contact.email = verifiedEmail;
                  contact.emailProviderVerified = true;
                  contact.verificationStatus = 'verified';
                  console.log(`   ✅ [STAGE 3] RocketReach lookup found: ${verifiedEmail}`);
                }
              } catch (lookupErr) {
                console.error(`   ⚠️ [STAGE 3] Lookup failed for ${contact.fullName}:`, lookupErr);
              }
            }

            // Have an email but not provider-verified — run a lightweight MX check
            // to confirm the domain can actually receive mail.
            if (contact.email && !contact.emailProviderVerified) {
              try {
                const vResult = await verifyEmail(contact.email);
                contact.verificationStatus = vResult.status;
                console.log(`   🛡️ [STAGE 3] ${contact.email} → ${vResult.status}`);
              } catch (vErr) {
                contact.verificationStatus = 'unknown';
                console.error(`   ⚠️ [STAGE 3] MX check failed for ${contact.email}:`, vErr);
              }
            }
          }));

          const hasVerifiedContacts = hasVerifiedOutreachContact(locked.contacts as any);
          locked.status = hasVerifiedContacts ? 'needs_drafts' : 'needs_verified_contacts';
          locked.last_error = hasVerifiedContacts
            ? undefined
            : 'Contacts found, but none have a verified email eligible for outreach.';
          (locked as any).contact_retry_count = 0;
          console.log(` ✅ [STAGE 3] ${locked.domain}: Found ${locked.contacts.length} profiles.`);
        } else {
          const retryCount = ((locked as any).contact_retry_count || 0) + 1;
          (locked as any).contact_retry_count = retryCount;
          if (retryCount >= MAX_CONTACT_RETRIES) {
            locked.status = 'rejected';
            console.log(` ⚠️ [STAGE 3] ${locked.domain}: No contacts after ${retryCount} attempts. Rejecting.`);
          } else {
            locked.status = 'needs_contacts';
            console.log(` ⚠️ [STAGE 3] ${locked.domain}: No contacts found (attempt ${retryCount}/${MAX_CONTACT_RETRIES}).`);
          }
        }
        await locked.save();
        return { domain: locked.domain, count: res.contacts?.length || 0 };
      } catch (err: any) {
        locked.status = 'needs_contacts';
        await locked.save();
        console.error(` ❌ [STAGE 3] ${locked.domain}: Error:`, err.message);
        return { domain: locked.domain, error: err.message };
      }
    }));

    const validResults = results.filter(Boolean);
    return { success: true, processed: validResults.length, details: validResults };
  } catch (error) {
    console.error('❌ [STAGE 3] Contact Fetching Error:', error);
    return { success: false, error: (error as Error).message };
  }
}

// ==========================================
// STAGE 4 — Email Drafting
// ==========================================
export async function processStage4Drafts() {
  try {
    await connectWithRetry();

    // Stage 4 uses a tighter stuck timeout — Ollama is fast, if it's stuck 5 min something crashed
    const stuckCutoff = new Date(Date.now() - MAX_STUCK_DRAFTING * 60 * 1000);
    await Company.updateMany(
      { status: 'drafting', updated_at: { $lt: stuckCutoff } },
      { $set: { status: 'needs_drafts' } }
    );

    // Process a batch of up to 5 companies per tick
    const companies = [];
    for (let i = 0; i < 5; i++) {
      const company = await Company.findOneAndUpdate(
        { status: 'needs_drafts' },
        { $set: { status: 'drafting' } },
        { returnDocument: 'after' }
      );
      if (!company) break;
      companies.push(company);
    }

    if (companies.length === 0) {
      console.log('ℹ️  [STAGE 4] No companies currently need drafts.');
      return { success: true, message: 'No companies needing drafts' };
    }

    console.log(`⏳ [STAGE 4] Processing batch of ${companies.length} companies for drafts...`);
    let totalDrafted = 0;

    for (const company of companies) {
      console.log(`   📝 [STAGE 4] Generating Emails for: ${company.domain}`);
      let draftedCount = 0;
      const mappedTechs = company.tech_stack.map((t: any) => t.name || String(t));

      for (const contact of company.contacts) {
        if (!canSendOutreachToContact(contact)) {
          console.log(`   ⏭️ [STAGE 4] Skipping ${contact.fullName} (${contact.email || 'no email'}) — status: ${contact.verificationStatus}, delivery: ${contact.deliveryStatus}`);
          continue;
        }

        if (!contact.drafts || contact.drafts.length === 0) {
          try {
            const draft = await generateInitialEmail(
              {
                firstName: contact.firstName,
                lastName: contact.lastName,
                title: contact.title || 'Decision Maker',
                company: company.name || company.domain,
              },
              {
                domain: company.domain,
                techStack: mappedTechs,
                legacyReasons: company.legacy_reasons,
                pagespeedScore: company.pagespeed_score,
              }
            );

            contact.drafts.push({
              subject: draft.subject,
              body: draft.body,
              type: 'initial',
              created_at: new Date(),
            } as any);

            draftedCount++;
            console.log(`   ✍️ Drafted email for ${contact.fullName}`);
            await company.save(); // Persist each draft immediately for safety
          } catch (e) {
            console.error(`   ⚠️ Email generation failed for ${contact.fullName}`, e);
          }
        }
      }

      company.status = draftedCount > 0 ? 'drafts_ready' : 'rejected';
      await company.save();
      totalDrafted += draftedCount;
      console.log(`   ✅ ${company.domain}: ${draftedCount} drafts generated.`);
    }

    console.log(`✅ [STAGE 4] Batch complete. ${totalDrafted} total email drafts across ${companies.length} companies.`);
    return { success: true, companiesProcessed: companies.length, draftsGenerated: totalDrafted };

  } catch (error) {
    console.error('❌ [STAGE 4] Email Drafting Error:', error);
    return { success: false, error: (error as Error).message };
  }
}

// ==========================================
// STAGE 5 — Automated Outreach
// Sends ready drafts autonomously
// ==========================================
export async function processStage5Outreach() {
  try {
    await connectWithRetry();
    console.log('⏳ [STAGE 5] Triggering OutreachAgent engagement tick...');
    const result = await OutreachAgent.runEngagementTick();
    console.log(`✅ [STAGE 5] Engagement tick done. Initial Sent=${result.initialSent}, Follow-ups=${result.followUpsSent}`);
    return { success: true, ...result };
  } catch (error) {
    console.error('❌ [STAGE 5] Outreach Error:', error);
    return { success: false, error: (error as Error).message };
  }
}

// ==========================================
// CRON DAEMON ENTRY
// ==========================================
export function startQueueProcessor() {
  console.log('🚀 Starting fully autonomous AI Pipeline...');

  const runStage1Scheduled = withStageLock('stage1', () => processStage1Scraping('scheduled'));
  const runStage1Startup = withStageLock('stage1', () => processStage1Scraping('startup'));
  triggerStage1LowWatermarkRefill = withStageLock('stage1', () => processStage1Scraping('low-watermark'));

  const tasks = [
    // Stage 1: seed hourly, but only if the queue is below the low-water mark
    cron.schedule('0 * * * *', runStage1Scheduled),
    // Stage 2: every minute
    cron.schedule('* * * * *', withStageLock('stage2', processStage2Analysis)),
    // Stage 3: every 1 minute
    cron.schedule('* * * * *', withStageLock('stage3', processStage3Contacts)),
    // Stage 4: every 3 minutes
    cron.schedule('*/3 * * * *', withStageLock('stage4', processStage4Drafts)),
    // Stage 5: every 5 minutes
    cron.schedule('*/5 * * * *', withStageLock('stage5', processStage5Outreach)),
    // Reply Sync: every 10 minutes
    cron.schedule('*/10 * * * *', async () => {
      console.log('🔄 [IMAP] Syncing replies...');
      try {
        const found = await EmailManager.syncReplies();
        if (found > 0) console.log(`📩 [IMAP] Found ${found} new replies.`);
      } catch (err) {
        console.error('❌ [IMAP] Sync Error:', err);
      }
    }),
  ];

  const shutdown = () => {
    console.log('\n🛑 Graceful shutdown: stopping cron tasks...');
    tasks.forEach(t => t.stop());
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log('✅ Background Pipeline Registered:');
  console.log('   - Scraper       → On startup + hourly + low-watermark refill');
  console.log('   - Analyzer      → Every 1m');
  console.log('   - Contacts      → Every 1m');
  console.log('   - Email Drafter → Every 3m');
  console.log('   - Outreach      → Every 5m');
  console.log('   - Reply Sync    → Every 10m');

  void runStage1Startup();
}
