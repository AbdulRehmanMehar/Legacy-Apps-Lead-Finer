#!/usr/bin/env tsx
/**
 * Pipeline Test Script
 * Usage:
 *   npx tsx scripts/test-pipeline.ts             — runs all stages in sequence
 *   npx tsx scripts/test-pipeline.ts stage1       — test discovery only
 *   npx tsx scripts/test-pipeline.ts stage2       — test analyzer only
 *   npx tsx scripts/test-pipeline.ts stage3       — test contacts only
 *   npx tsx scripts/test-pipeline.ts stage4       — test email drafter only
 *   npx tsx scripts/test-pipeline.ts discovery    — test PublicWWW + CommonCrawl in isolation
 *   npx tsx scripts/test-pipeline.ts health       — check all API connections
 */

import {
  processStage1Scraping,
  processStage2Analysis,
  processStage3Contacts,
  processStage4Drafts,
} from '../lib/workers/queue-processor';
import {
  discoverLeads,
} from '../lib/services/discovery';
import { checkRocketReachHealth } from '../lib/services/rocketreach';
import { checkOllamaHealth } from '../lib/services/ollama';
import dbConnect from '../lib/mongodb';
import { Company, AnalysisQueueItem } from '../lib/models';
import mongoose from 'mongoose';

// ============================================================
// PRETTY PRINT HELPERS
// ============================================================
const sep = () => console.log('\n' + '─'.repeat(60));
const pass = (msg: string) => console.log(`  ✅ ${msg}`);
const fail = (msg: string) => console.log(`  ❌ ${msg}`);
const info = (msg: string) => console.log(`  ℹ️  ${msg}`);
const warn = (msg: string) => console.log(`  ⚠️  ${msg}`);
function printResult(label: string, result: any) {
  console.log(`\n  Result [${label}]:`);
  console.log(JSON.stringify(result, null, 2).split('\n').map(l => '  ' + l).join('\n'));
}

// ============================================================
// HEALTH CHECK
// ============================================================
async function testHealth() {
  sep();
  console.log('🏥 Health Checks');
  sep();

  // MongoDB
  try {
    await dbConnect();
    const state = mongoose.connection.readyState;
    if (state === 1) {
      pass('MongoDB connection OK');
      const companyCount = await Company.countDocuments();
      const queueCount = await AnalysisQueueItem.countDocuments();
      info(`Companies in DB: ${companyCount}`);
      info(`Queue items in DB: ${queueCount}`);
      info(`  ↳ Pending: ${await AnalysisQueueItem.countDocuments({ status: 'pending' })}`);
      info(`  ↳ Processing: ${await AnalysisQueueItem.countDocuments({ status: 'processing' })}`);
      info(`  ↳ Failed: ${await AnalysisQueueItem.countDocuments({ status: 'failed' })}`);
      info(`Companies by status:`);
      const statuses = ['new', 'needs_contacts', 'fetching_contacts', 'needs_verified_contacts', 'needs_drafts', 'drafting', 'drafts_ready', 'rejected'];
      for (const s of statuses) {
        const count = await Company.countDocuments({ status: s });
        if (count > 0) info(`  ↳ ${s}: ${count}`);
      }
    } else {
      fail(`MongoDB not connected (state=${state})`);
    }
  } catch (e) {
    fail(`MongoDB error: ${(e as Error).message}`);
  }

  // RocketReach
  const rr = await checkRocketReachHealth();
  if (rr.healthy) {
    pass(`RocketReach API OK${rr.credits !== undefined ? ` (credits: ${rr.credits})` : ''}`);
  } else {
    warn(`RocketReach: ${rr.error}`);
  }

  // Ollama
  const ollama = await checkOllamaHealth();
  if (ollama.healthy) {
    pass('Ollama OK (qwen2.5 model found)');
  } else {
    warn(`Ollama: ${ollama.error}`);
  }

  // APIFY (optional)
  if (process.env.APIFY_API_TOKEN) {
    pass('APIFY_API_TOKEN set (optional, not needed anymore)');
  } else {
    info('APIFY_API_TOKEN not set (not needed — using Tranco Top 1M List)');
  }
}

// ============================================================
// STAGE 1 — Full Discovery Worker
// ============================================================
async function testStage1() {
  sep();
  console.log('⚙️  Stage 1 — Full Discovery Worker');
  sep();
  info('This downloads the top 1M Tranco domains list and queues a random sample');
  const result = await processStage1Scraping();
  printResult('Stage 1', result);
  if (result.success) {
    pass(`Queued ${(result as any).count} new domains for ${(result as any).tech}`);
  } else {
    fail(`Stage 1 failed: ${(result as any).error}`);
  }
}

// ============================================================
// STAGE 2 — Tech Stack Analyzer
// ============================================================
async function testStage2() {
  sep();
  console.log('🔬 Stage 2 — Tech Stack Analyzer');
  sep();

  await dbConnect();
  const pendingCount = await AnalysisQueueItem.countDocuments({ status: 'pending' });

  if (pendingCount === 0) {
    warn('No pending queue items found.');
    warn('Run Stage 1 first (or add a domain manually):');
    info('  npx tsx scripts/test-pipeline.ts stage1');
    info('  OR seed a specific domain:');
    info('  npx tsx -e "import \'../lib/workers/queue-processor\'"');
    return;
  }

  info(`${pendingCount} pending items in queue. Processing the oldest one...`);
  const result = await processStage2Analysis();
  printResult('Stage 2', result);
  if (result.success) {
    pass(`Analysis done for ${(result as any).domain} — Legacy: ${(result as any).isLegacy}`);
  } else {
    fail(`Stage 2 failed: ${(result as any).error}`);
  }
}

// ============================================================
// STAGE 3 — Contact Fetcher
// ============================================================
async function testStage3() {
  sep();
  console.log('👥 Stage 3 — Contact Fetcher (RocketReach)');
  sep();

  await dbConnect();
  const waitingCount = await Company.countDocuments({ status: 'needs_contacts' });

  if (waitingCount === 0) {
    warn('No companies with status=needs_contacts.');
    warn('Run Stage 2 first until it finds a legacy company.');
    return;
  }

  info(`${waitingCount} companies waiting for contact enrichment. Processing one...`);
  const result = await processStage3Contacts();
  printResult('Stage 3', result);
  if (result.success) {
    pass(`Contact fetch done for ${(result as any).domain} — Found: ${(result as any).contactsFound}`);
  } else {
    fail(`Stage 3 failed: ${(result as any).error}`);
  }
}

// ============================================================
// STAGE 4 — Email Drafter
// ============================================================
async function testStage4() {
  sep();
  console.log('✉️  Stage 4 — Email Drafter (Ollama)');
  sep();

  await dbConnect();
  const waitingCount = await Company.countDocuments({ status: 'needs_drafts' });

  if (waitingCount === 0) {
    warn('No companies with status=needs_drafts.');
    warn('Run Stage 3 first.');
    return;
  }

  info(`${waitingCount} companies waiting for email drafts. Processing one...`);
  info('Note: Ollama takes 30–120 seconds per email. Please wait...');
  const result = await processStage4Drafts();
  printResult('Stage 4', result);
  if (result.success) {
    pass(`Email drafting done for ${(result as any).domain} — Generated: ${(result as any).draftsGenerated}`);
  } else {
    fail(`Stage 4 failed: ${(result as any).error}`);
  }
}

// ============================================================
// SEED — Add test domain directly to queue
// ============================================================
async function seedTestDomain(domain: string) {
  sep();
  console.log(`🌱 Seeding test domain: ${domain}`);
  sep();
  await dbConnect();

  const existing = await AnalysisQueueItem.findOne({ domain });
  if (existing) {
    warn(`${domain} already in queue (status: ${existing.status})`);
    return;
  }
  await AnalysisQueueItem.create({ company_id: 'test', domain, status: 'pending' });
  pass(`${domain} added to analysis queue`);
}

// ============================================================
// MAIN ENTRY
// ============================================================
async function main() {
  const arg = process.argv[2] || 'all';

  console.log('');
  console.log('🚀 Legacy Leads Finder — Pipeline Test Script');
  console.log(`   Mode: ${arg}`);
  console.log(`   Time: ${new Date().toLocaleString()}`);

  try {
    switch (arg) {
      case 'health':
        await testHealth();
        break;
      case 'discovery':
        sep();
        console.log('🔍 Testing Tranco List Downloader...');
        sep();
        const res = await discoverLeads('any', 5);
        pass(`Tranco returned ${res.domains.length} random domains`);
        res.domains.forEach(d => info(d));
        break;
      case 'stage1':
        await testHealth();
        await testStage1();
        break;
      case 'stage2':
        await testHealth();
        await testStage2();
        break;
      case 'stage3':
        await testHealth();
        await testStage3();
        break;
      case 'stage4':
        await testHealth();
        await testStage4();
        break;
      case 'seed': {
        const domain = process.argv[3];
        if (!domain) { fail('Usage: npx tsx scripts/test-pipeline.ts seed <domain>'); break; }
        await seedTestDomain(domain);
        break;
      }
      case 'all':
      default:
        await testHealth();
        await testStage1();
        await testStage2();
        await testStage3();
        await testStage4();
        break;
    }
  } catch (e) {
    console.error('\n❌ Unhandled error:', e);
  } finally {
    sep();
    console.log('✅ Test script finished.\n');
    await mongoose.disconnect();
  }
}

main();
