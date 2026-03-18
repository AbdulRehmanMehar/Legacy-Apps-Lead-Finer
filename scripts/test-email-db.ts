#!/usr/bin/env tsx

import dbConnect from '../lib/mongodb';
import { Company } from '../lib/models';
import {
  checkOllamaHealth,
  generateFollowupEmail,
  generateInitialEmail,
} from '../lib/services/ollama';
import { canSendOutreachToContact } from '../lib/utils';

type ScriptOptions = {
  limit: number;
  includeFollowup: boolean;
  domain?: string;
  allowUnverified: boolean;
};

type ContactSelection = {
  contact: SampleContact;
  mode: 'sendable' | 'fallback';
};

type SampleContact = {
  firstName: string;
  lastName: string;
  fullName: string;
  title: string;
  email: string | null;
  drafts?: Array<{ subject: string; body: string; type: string; sent_at?: Date | string }>;
  verificationStatus?: string;
  emailProviderVerified?: boolean;
  deliveryStatus?: string;
};

type SampleCompany = {
  domain: string;
  name?: string | null;
  status: string;
  sampleMode?: 'sendable' | 'fallback';
  legacy_reasons?: string[];
  pagespeed_score?: number | null;
  tech_stack?: Array<{ name?: string }>;
  contacts?: SampleContact[];
};

function parseArgs(argv: string[]): ScriptOptions {
  const options: ScriptOptions = {
    limit: 3,
    includeFollowup: true,
    allowUnverified: true,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if ((arg === '--limit' || arg === '-n') && argv[index + 1]) {
      options.limit = Math.max(1, Number.parseInt(argv[index + 1], 10) || 3);
      index++;
      continue;
    }

    if (arg === '--domain' && argv[index + 1]) {
      options.domain = argv[index + 1].trim().toLowerCase();
      index++;
      continue;
    }

    if (arg === '--no-followup') {
      options.includeFollowup = false;
      continue;
    }

    if (arg === '--allow-unverified') {
      options.allowUnverified = true;
      continue;
    }

    if (arg === '--strict-sendable') {
      options.allowUnverified = false;
      continue;
    }
  }

  return options;
}

function separator(label?: string) {
  const line = '─'.repeat(72);
  console.log(`\n${line}`);
  if (label) console.log(label);
  console.log(line);
}

function chooseContact(company: SampleCompany, allowUnverified: boolean): ContactSelection | null {
  const contacts = company.contacts ?? [];
  const eligible = contacts.find((contact) => canSendOutreachToContact(contact as any));
  if (eligible) {
    return { contact: eligible, mode: 'sendable' };
  }

  if (!allowUnverified) return null;

  const fallback = contacts.find((contact) => Boolean(contact.email && contact.firstName));
  return fallback ? { contact: fallback, mode: 'fallback' } : null;
}

async function fetchSamples(options: ScriptOptions): Promise<SampleCompany[]> {
  const matchStage: Record<string, unknown> = {
    'contacts.0': { $exists: true },
  };

  if (options.domain) {
    matchStage.domain = options.domain;
  }

  const companies = await Company.aggregate([
    { $match: matchStage },
    ...(options.domain ? [] : [{ $sample: { size: options.limit * 4 } }]),
    {
      $project: {
        domain: 1,
        name: 1,
        status: 1,
        legacy_reasons: 1,
        pagespeed_score: 1,
        tech_stack: 1,
        contacts: 1,
      },
    },
    ...(options.domain ? [{ $limit: options.limit }] : []),
  ]);

  const selected: SampleCompany[] = [];
  for (const company of companies as SampleCompany[]) {
    const chosen = chooseContact(company, options.allowUnverified);
    if (!chosen) continue;

    selected.push({
      ...company,
      sampleMode: chosen.mode,
      contacts: [chosen.contact],
    });

    if (selected.length >= options.limit) break;
  }

  return selected;
}

function printLeadContext(company: SampleCompany, contact: SampleContact) {
  const techNames = (company.tech_stack ?? [])
    .map((tech) => tech?.name)
    .filter(Boolean)
    .slice(0, 6)
    .join(', ');

  console.log(`company: ${company.name || company.domain}`);
  console.log(`domain: ${company.domain}`);
  console.log(`status: ${company.status}`);
  console.log(`contact: ${contact.fullName || `${contact.firstName} ${contact.lastName}`.trim()}${contact.title ? ` (${contact.title})` : ''}`);
  console.log(`email: ${contact.email || 'none'}`);
  console.log(`verification: ${contact.verificationStatus || 'unknown'} | provider-verified: ${String(contact.emailProviderVerified ?? false)} | delivery: ${contact.deliveryStatus || 'unknown'}`);
  console.log(`pagespeed: ${company.pagespeed_score ?? 'unknown'}`);
  console.log(`legacy reasons: ${(company.legacy_reasons ?? []).slice(0, 4).join(' | ') || 'none'}`);
  console.log(`tech stack: ${techNames || 'unknown'}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  separator('email generation test from database');
  console.log(`limit: ${options.limit}`);
  console.log(`include follow-up: ${options.includeFollowup}`);
  console.log(`allow unverified fallback: ${options.allowUnverified}`);
  if (options.domain) console.log(`domain filter: ${options.domain}`);

  const ollama = await checkOllamaHealth();
  if (!ollama.healthy) {
    throw new Error(`Ollama unavailable: ${ollama.error}`);
  }

  await dbConnect();
  const samples = await fetchSamples(options);

  if (samples.length === 0) {
    throw new Error('No matching companies found with usable contacts. Try --allow-unverified or --domain <site>.');
  }

  for (let index = 0; index < samples.length; index++) {
    const company = samples[index];
    const contact = company.contacts?.[0];
    if (!contact) continue;

    separator(`sample ${index + 1}`);
    printLeadContext(company, contact);
    if (company.sampleMode === 'fallback') {
      console.log('note: using fallback contact with an email for copy preview only, not a send-eligible contact');
    }

    const initial = await generateInitialEmail(
      {
        firstName: contact.firstName || contact.fullName?.split(' ')[0] || 'there',
        lastName: contact.lastName || '',
        title: contact.title || 'Decision Maker',
        company: company.name || company.domain,
      },
      {
        domain: company.domain,
        techStack: (company.tech_stack ?? []).map((tech) => tech?.name || '').filter(Boolean),
        legacyReasons: company.legacy_reasons ?? [],
        pagespeedScore: company.pagespeed_score ?? null,
      }
    );

    console.log('\ninitial email');
    console.log(`subject: ${initial.subject}`);
    console.log('body:');
    console.log(initial.body);

    if (!options.includeFollowup) continue;

    const previousInitial = contact.drafts?.find((draft) => draft.type === 'initial' && draft.sent_at);
    const followup = await generateFollowupEmail(
      {
        firstName: contact.firstName || contact.fullName?.split(' ')[0] || 'there',
        lastName: contact.lastName || '',
        title: contact.title || 'Decision Maker',
        company: company.name || company.domain,
      },
      {
        subject: previousInitial?.subject || initial.subject,
        body: previousInitial?.body || initial.body,
        sentAt: previousInitial?.sent_at ? new Date(previousInitial.sent_at) : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
      1
    );

    console.log('\nfollow-up email');
    console.log(`subject: ${followup.subject}`);
    console.log('body:');
    console.log(followup.body);
  }
}

main()
  .catch((error) => {
    console.error('\nemail generation test failed');
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    try {
      const mongoose = await import('mongoose');
      if (mongoose.default.connection.readyState !== 0) {
        await mongoose.default.disconnect();
      }
    } catch {
      // ignore disconnect cleanup errors in a test script
    }
  });
