/**
 * Ollama Service - Connects to local Ollama instance running qwen2.5:7b
 * Used for generating search queries and writing outreach emails
 */

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  timeout: number;
}

import { EnrichmentData } from '../types';

export interface OllamaResponse {
  model: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  eval_count?: number;
}

export interface GeneratedEmail {
  subject: string;
  body: string;
}

interface InitialEmailAngle {
  type: 'speed' | 'mobile-ux' | 'maintenance' | 'content-velocity' | 'conversion-friction' | 'general';
  observation: string;
  consequence: string;
  question: string;
  asset: string;
  cta: string;
  structure: 'direct' | 'split' | 'lean';
  followupOffer: string;
  guidance: string[];
}

function toSubjectSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.[a-z]{2,}(\.[a-z]{2,})?$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildInitialSubject(company: string, domain: string): string {
  const companySlug = toSubjectSlug(company);
  const domainSlug = toSubjectSlug(domain);
  const label = companySlug || domainSlug || 'your site';
  const subjectOptions = [
    `quick note on ${label}`,
    `noticed this on ${label}`,
    `${label} - quick observation`,
    'quick note on your site',
  ];

  return subjectOptions[Math.floor(Math.random() * subjectOptions.length)];
}

const DEFAULT_CONFIG: OllamaConfig = {
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
  timeout: 120000, // 2 minutes for generation
};

/**
 * Check if Ollama is available and the model is loaded
 */
export async function checkOllamaHealth(): Promise<{ healthy: boolean; error?: string }> {
  try {
    const response = await fetch(`${DEFAULT_CONFIG.baseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { healthy: false, error: 'Ollama server not responding' };
    }

    const data = await response.json();
    const models = data.models || [];
    const hasModel = models.some((m: { name: string }) => 
      m.name.includes('qwen2.5') || m.name === DEFAULT_CONFIG.model
    );

    if (!hasModel) {
      return { 
        healthy: false, 
        error: `Model ${DEFAULT_CONFIG.model} not found. Run: ollama pull qwen2.5:7b` 
      };
    }

    return { healthy: true };
  } catch (error) {
    return { 
      healthy: false, 
      error: `Cannot connect to Ollama at ${DEFAULT_CONFIG.baseUrl}. Is it running?` 
    };
  }
}

/**
 * Generate text using Ollama
 */
async function generate(prompt: string, systemPrompt?: string): Promise<string> {
  const response = await fetch(`${DEFAULT_CONFIG.baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DEFAULT_CONFIG.model,
      prompt: prompt,
      system: systemPrompt,
      stream: false,
      options: {
        temperature: 0.7,
        top_p: 0.9,
        num_predict: 2048,
      },
    }),
    signal: AbortSignal.timeout(DEFAULT_CONFIG.timeout),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama generation failed: ${error}`);
  }

  const data: OllamaResponse = await response.json();
  return data.response.trim();
}

/**
 * Retry wrapper with exponential backoff.
 * Retries up to `maxRetries` times, with delay doubling on each attempt.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  initialDelayMs = 3000
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt);
        console.warn(`[ollama] Attempt ${attempt + 1} failed, retrying in ${delay}ms... (${lastError.message})`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

function pickInitialEmailAngle(companyAnalysis: {
  techStack: string[];
  legacyReasons: string[];
  pagespeedScore: number | null;
}): InitialEmailAngle {
  const pagespeedScore = companyAnalysis.pagespeedScore;
  const reasons = companyAnalysis.legacyReasons.map((reason) => reason.toLowerCase());
  const techStack = companyAnalysis.techStack.map((tech) => tech.toLowerCase());
  const candidates: InitialEmailAngle[] = [];

  const pickOne = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
  const hasCommerceStack = techStack.some((tech) =>
    ['shopify', 'magento', 'woocommerce', 'bigcommerce', 'prestashop'].includes(tech)
  );

  if (reasons.some((reason) => reason.includes('drupal 7/8') || reason.includes('outdated wordpress') || reason.includes('end-of-life version'))) {
    candidates.push({
      type: 'maintenance',
      observation: pickOne([
        'my guess is simple page edits are taking more steps than they should once someone is in the cms.',
        'it looks like publishing or updating homepage content probably takes more manual cleanup than it should.',
      ]),
      consequence: pickOne([
        'that usually becomes a drag once campaigns or homepage updates need to move quickly.',
        'that tends to slow teams down once a few people are touching landing pages or promos.',
      ]),
      question: pickOne([
        'does that sound familiar on your side?',
        'has that become a bottleneck yet?',
      ]),
      asset: pickOne([
        'a short teardown of the pages that look hardest to update',
        '3 notes on where update flow is probably getting slowed down',
      ]),
      cta: pickOne([
        'want me to send that over?',
        'worth me sending those notes?',
      ]),
      structure: pickOne(['direct', 'split', 'lean']),
      followupOffer: 'a 5-point teardown of the pages that look hardest to maintain',
      guidance: [
        'do not open with the cms or framework name',
        'anchor on maintenance drag, slower updates, or internal friction',
      ],
    });

    candidates.push({
      type: 'content-velocity',
      observation: pickOne([
        'it looks like simple content changes may be taking more steps than they should before a page can go live.',
        'my guess is the team is probably doing more workaround-y stuff than it should for landing page updates.',
      ]),
      consequence: pickOne([
        'that usually shows up when someone needs a page live fast and the site pushes back.',
        'that tends to create drag right when a promo, banner, or landing page needs a quick change.',
      ]),
      question: pickOne([
        'has that been an issue at all?',
        'does that ever hold campaigns up?',
      ]),
      asset: pickOne([
        'a short teardown focused on update bottlenecks',
        'the first few pages i\'d check for content friction',
      ]),
      cta: pickOne([
        'want me to send that over?',
        'want the short version?',
      ]),
      structure: pickOne(['direct', 'split', 'lean']),
      followupOffer: 'a short teardown focused on update bottlenecks and quick wins',
      guidance: [
        'talk about speed of updates, not migration',
        'keep the value concrete and low-friction',
      ],
    });
  }

  if (pagespeedScore !== null && pagespeedScore < 35) {
    candidates.push({
      type: 'speed',
      observation: pickOne([
        'there\'s a slight delay before the homepage becomes interactive on mobile.',
        hasCommerceStack
          ? 'there\'s a slight delay before the homepage is usable on mobile, especially before someone can start browsing.'
          : 'there\'s a slight delay before the homepage is usable on mobile, especially before someone can scroll or tap anything.',
      ]),
      consequence: pickOne([
        'that\'s usually where we see people hesitate before they even get into the page.',
        'that early pause is often where drop-off starts creeping in.',
      ]),
      question: pickOne([
        `has that started showing up in drop-off yet?`,
        `have you noticed that on the first visit?`,
      ]),
      asset: pickOne([
        'the first 3 fixes i\'d check on the homepage',
        'a quick teardown of the biggest first-load bottlenecks',
      ]),
      cta: pickOne([
        'want me to send that over?',
        'want the teardown?',
      ]),
      structure: pickOne(['split', 'lean']),
      followupOffer: 'a quick teardown of the biggest speed bottlenecks i\'d check first',
      guidance: [
        `use the mobile performance score (${pagespeedScore}/100) as one possible proof point, not the entire email`,
        'tie the issue to conversions, ux, or site speed',
      ],
    });

    candidates.push({
      type: 'mobile-ux',
      observation: pickOne([
        hasCommerceStack
          ? 'on mobile there\'s a pause before products really show up on the homepage.'
          : 'on mobile there\'s a pause before the page really settles and feels interactive.',
        hasCommerceStack
          ? 'the first load on mobile takes a beat before someone can scroll the homepage and start browsing.'
          : 'the hero area takes a beat before someone can scroll or tap anything on mobile.',
      ]),
      consequence: pickOne([
        hasCommerceStack
          ? 'that\'s usually where we see people drop before they even start browsing.'
          : 'that\'s usually enough for people to bounce before they get into the page.',
        hasCommerceStack
          ? 'that first pause is often where browse intent dies.'
          : 'that first pause is often where drop-off starts creeping in.',
      ]),
      question: pickOne([
        'have you seen that on mobile?',
        'has that come up in drop-off at all?',
      ]),
      asset: pickOne([
        'annotated mobile screenshots showing the first friction points',
        '3 quick notes on the spots that feel sticky on mobile',
      ]),
      cta: pickOne([
        'want me to send those over?',
        'worth me sending the screenshots?',
      ]),
      structure: pickOne(['direct', 'split']),
      followupOffer: 'annotated mobile notes showing the first friction points i\'d clean up',
      guidance: [
        'lead with the on-site experience, not a developer metric',
        'keep the language human and commercial',
      ],
    });
  }

  if (pagespeedScore !== null && pagespeedScore < 50) {
    candidates.push({
      type: 'conversion-friction',
      observation: pickOne([
        'the first visit feels a little slower than it should before anything really becomes interactive.',
        hasCommerceStack
          ? 'there\'s a small delay before someone can properly get into browsing the homepage.'
          : 'there\'s a short delay before the page feels settled enough to scroll or tap through.',
      ]),
      consequence: pickOne([
        'that\'s usually where some of the easy conversion loss starts.',
        'that kind of pause is often enough to create hesitation early.',
      ]),
      question: pickOne([
        'have you noticed that at all?',
        'has that shown up in drop-off?',
      ]),
      asset: pickOne([
        'a short list of the first conversion bottlenecks i\'d check',
        '3 notes on where the first-visit friction seems to be happening',
      ]),
      cta: pickOne([
        'want me to send that over?',
        'worth me sending the notes?',
      ]),
      structure: pickOne(['lean', 'direct']),
      followupOffer: 'a short list of the first conversion-friction issues i\'d check',
      guidance: [
        'frame the issue around ux and conversion friction',
        'do not let the score become the whole hook',
      ],
    });
  }

  if (reasons.some((reason) => reason.includes('largest contentful paint') || reason.includes('blocking time') || reason.includes('performance')) || techStack.includes('jquery')) {
    candidates.push({
      type: 'general',
      observation: pickOne([
        hasCommerceStack
          ? 'the first load feels heavier than it should before someone can really browse the homepage.'
          : 'the first impression feels a bit slower and clunkier than it should, especially before the first scroll.',
        hasCommerceStack
          ? 'there\'s a noticeable beat before the page feels ready to browse.'
          : 'the page takes a beat before it feels properly settled enough to scroll or tap.',
      ]),
      consequence: pickOne([
        'that\'s usually enough to lose people before they get into the page.',
        'that tends to make the whole site feel older than it probably is right away.',
      ]),
      question: pickOne([
        'have you noticed that at all?',
        'has that come up internally?',
      ]),
      asset: pickOne([
        'a 5-point teardown of the first-load bottlenecks',
        'the first few areas i\'d check on the page',
      ]),
      cta: pickOne([
        'want me to send that over?',
        'worth me sending the teardown?',
      ]),
      structure: pickOne(['split', 'lean']),
      followupOffer: 'the first bottlenecks i\'d check on the site',
      guidance: [
        'do not say jquery, react, or vue in the opener or problem paragraph',
        'anchor on site speed, conversions, or ux instead of tech names',
      ],
    });
  }

  candidates.push({
    type: 'general',
    observation: pickOne([
      'a couple parts of the site look like they\'re making the first visit harder than it needs to be, especially before someone can really interact.',
      'it feels like the site is making people work a little too hard before they can scroll, tap, or get into the page properly.',
    ]),
    consequence: pickOne([
      'that\'s usually where we see small conversion leaks start showing up.',
      'that tends to chip away at momentum earlier than people expect.',
    ]),
    question: pickOne([
      'has that shown up at all?',
      'have you noticed that yet?',
    ]),
    asset: pickOne([
      'a short teardown with the first 3 issues i\'d check',
      'the first few notes i\'d send after a quick pass through the site',
    ]),
    cta: pickOne([
      'want me to send that over?',
      'worth me sending the notes?',
    ]),
    structure: pickOne(['direct', 'lean', 'split']),
    followupOffer: 'a short teardown with the first quick wins i\'d look at',
    guidance: [
      'lead with business impact, not implementation details',
      'keep the ask low-friction and centered on a teardown, notes, or quick wins',
    ],
  });

  const nonScoreCandidates = candidates.filter((candidate) => candidate.type !== 'speed');
  const pool = nonScoreCandidates.length > 0 ? nonScoreCandidates : candidates;
  return pickOne(pool);
}

function buildInitialFallbackEmail(firstName: string, opener: string, angle: InitialEmailAngle): string {
  const offerLine = `i can send ${angle.asset} if useful.`;

  if (angle.structure === 'split') {
    return `hey ${firstName.toLowerCase()}, ${opener}\n\n${angle.observation}\n\n${angle.consequence}\n\n${angle.question} ${offerLine}\nabdul`;
  }

  if (angle.structure === 'lean') {
    return `hey ${firstName.toLowerCase()}, ${opener}\n\n${angle.observation} ${angle.consequence}\n\n${angle.question}\n\n${offerLine}\nabdul`;
  }

  return `hey ${firstName.toLowerCase()}, ${opener}\n\n${angle.observation} ${angle.consequence}\n\n${angle.question} ${offerLine}\nabdul`;
}

function shouldUseInitialFallback(body: string, angle: InitialEmailAngle): boolean {
  const normalized = body.toLowerCase();

  const forbiddenPhrases = [
    'migration',
    'migrate',
    'rebuild',
    'nextjs',
    'react',
    'vue',
    'jquery',
    'i read',
    'you should',
    'you need to',
    'consider migrating',
    'book a demo',
    'schedule a call',
    'hoping you\'re well',
  ];

  const leadsWithTech = /\n\n(?:noticed|saw|poked around|looks like).{0,120}\b(jquery|react|vue|angular|nextjs|wordpress|drupal|php|bootstrap|silverstripe)\b/i.test(normalized);
  const missingLowFrictionAsk = !/(quick audit|quick wins|teardown|notes|first few fixes|bottlenecks)/i.test(normalized);
  const mentionsTeachingLanguage = /(i read|you should|you need to|consider migrating)/i.test(normalized);
  const hasForbiddenPhrase = forbiddenPhrases.some((phrase) => normalized.includes(phrase));
  const tooPagespeedDriven = (normalized.match(/pagespeed|performance score/g) || []).length > 1;
  const scoreUsedOutsideSpeedHook = angle.type !== 'speed' && /(pagespeed|performance score|\/100)/i.test(normalized);
  const genericFrameworkPhrases = /(quick wins i\'d flag first|similar team|friction is visible|experience feel dated|affecting conversion rate|causing friction|obvious fixes hiding in plain sight)/i.test(normalized);
  const badSignoffShape = !/\nabdul\s*$/i.test(body);
  const extraCtaDrift = /(wanna take a look|want to take a look|want to share\?|open to a chat)/i.test(normalized);
  const missingConcreteObservation = !/(homepage|hero|menu|content|products|scroll|tap|interactive|usable on mobile|first visit|first load|first interaction|landing page|cms)/i.test(normalized);

  return leadsWithTech || missingLowFrictionAsk || mentionsTeachingLanguage || hasForbiddenPhrase || tooPagespeedDriven || scoreUsedOutsideSpeedHook || genericFrameworkPhrases || badSignoffShape || extraCtaDrift || missingConcreteObservation;
}

function buildFollowupFallback(previousBody: string, offer: string): string {
  const normalized = previousBody.toLowerCase();

  if (normalized.includes('mobile') || normalized.includes('browse')) {
    return `i marked up 3 screenshots where the first mobile visit gets sticky. want me to send those over?\n\nabdul`;
  }

  if (normalized.includes('content') || normalized.includes('update')) {
    return `i mapped the 3 pages that probably take the most effort to update. want me to send that over?\n\nabdul`;
  }

  return `i jotted down the first 3 places the page loses momentum. want me to send that over?\n\nabdul`;
}

function shouldUseFollowupFallback(body: string): boolean {
  const normalized = body.toLowerCase();

  return /(following up|circling back|checking in|touching base|brief site audit|consider a brief|quick audit\?|thoughts\?|just wanted to)/i.test(normalized)
    || !/(teardown|notes|breakdown|bottlenecks|quick wins|screenshots|pages)/i.test(normalized)
    || !/\n\s*abdul\s*$/i.test(body)
    || /boost scores|help\?|significantly|improvements could|want to share\?|open to a chat/i.test(normalized)
    || !/(send|sending|send over)/i.test(normalized);
}

/**
 * Generate search queries for finding multi-million dollar companies
 */
export async function generateSearchQueries(
  industry: string,
  criteria: string,
  count: number = 5
): Promise<string[]> {
  const systemPrompt = `You are an expert at finding B2B companies that need website modernization services.
Your task is to generate Google search queries that will find multi-million dollar companies with outdated technology stacks.
Focus on companies that likely have:
- Legacy websites (old CMS, outdated design, slow performance)
- Traditional industries that may not have modernized
- Established businesses with budget for website improvements`;

  const prompt = `Generate ${count} unique Google search queries to find companies in the ${industry} industry.

Additional criteria: ${criteria || 'None specified'}

Requirements for the queries:
1. Target companies with revenue $1M+ (use terms like "leading", "established", "top")
2. Focus on finding company websites, not directories
3. Include location-specific queries if relevant
4. Mix general and specific queries

Return ONLY the search queries, one per line, no numbering or explanation.`;

  const response = await withRetry(() => generate(prompt, systemPrompt));
  
  // Parse response into individual queries
  const queries = response
    .split('\n')
    .map(q => q.trim())
    .filter(q => q.length > 0 && !q.startsWith('#') && !q.match(/^\d+\./))
    .slice(0, count);

  return queries;
}

/**
 * Generate personalized initial outreach email
 */
export async function generateInitialEmail(
  contact: {
    firstName: string;
    lastName: string;
    title: string;
    company: string;
  },
  companyAnalysis: {
    domain: string;
    techStack: string[];
    legacyReasons: string[];
    pagespeedScore: number | null;
  },
  customPrompt?: string
): Promise<GeneratedEmail> {
  const systemPrompt = `you ghostwrite cold emails. you sound like a real human texting a colleague, not a marketer.

rules:
- 40-60 words max for the entire email body. seriously.
- subject line: will be provided for you. do not change it. do not write your own subject.
- all lowercase. no capitalization at all. no exceptions.
- use contractions (don't, can't, we've, site's). short sentences.
- never use: modernize, enhance, streamline, leverage, optimize, delve, boost, cutting-edge, innovative, solution, outreach, transform, scalable
- never use em dashes (—). use commas or periods.
- never mention: scheduling calls, booking meetings, demos, or "hoping you're well"
- never lead with tech names like jquery, react, vue, nextjs, wordpress, drupal, php, or "framework"
- lead with business impact first: conversions, speed, revenue, ux friction, slower updates, or customer experience
- do not teach the recipient, do not say "i read," "you should," or anything that sounds preachy or uncertain
- be specific about one real observation when possible. prefer what a human would notice on the page over quoting a tool score.
- keep the first line curious, but do not make it weak or overly casual
- sell a low-friction first step, not a migration. the ask should be screenshots, notes, a teardown, or first fixes
- one specific problem per email. don't list multiple issues.
- the email should feel like you're texting someone you met at a conference last month.

structure (separated by blank lines):
1. opener: one casual sentence. provided for you - use it exactly as given.
2. observation: 1-2 sentences. mention one specific issue naturally. make it concrete. ask a genuine question about the business impact.
3. consequence: 1 sentence. say what that observation usually causes in plain english.
4. question + soft offer: ask if they\'ve noticed it, then offer screenshots, notes, or a teardown in a natural way, then your name on the next line.

examples of great emails:

example 1:
subject: random thought
body:
hey sarah, this might sound random.

your homepage takes a few seconds before it really settles on mobile.

that\'s usually where people drop before they even get into the page.

curious if you\'ve noticed that? i can send the first 3 things i\'d check if useful.
abdul

example 2:
subject: quick q
body:
hey mike, had a random thought.

there\'s a pause before products really show up on first load.

that\'s usually where browse intent dies before someone even starts looking around.

have you noticed that at all? i can send annotated screenshots if useful.
abdul

example 3:
subject: quick thing
body:
hey lisa, honest question.

my guess is simple page edits are taking more steps than they should.

that usually becomes a drag when campaigns or content need to move quickly.

curious if that sounds familiar? i can send a short teardown if useful.
abdul`;
  const selectedAngle = pickInitialEmailAngle(companyAnalysis);
  const legacyIssues = companyAnalysis.legacyReasons.length > 0
    ? companyAnalysis.legacyReasons.slice(0, 3).join(', ')
    : 'performance and ux friction';

  const curiosityOpeners = [
    "been meaning to ask you something.",
    "had one question for you.",
    "something i noticed.",
    "wanted to ask you about something.",
    "curious about one thing.",
    "meant to ask you this.",
  ];
  const opener = curiosityOpeners[Math.floor(Math.random() * curiosityOpeners.length)];

  const subject = buildInitialSubject(contact.company, companyAnalysis.domain);
  const fallbackBody = buildInitialFallbackEmail(contact.firstName, opener, selectedAngle);

  const prompt = `Write a cold email for this lead. Follow the system prompt examples EXACTLY in tone and structure.

LEAD INFO:
- first name: ${contact.firstName.toLowerCase()}
- title: ${contact.title}
- company: ${contact.company}
- website: ${companyAnalysis.domain}

USE THIS EXACT ANGLE:
- observation: ${selectedAngle.observation}
- consequence: ${selectedAngle.consequence}
- business-impact question: ${selectedAngle.question}
- asset offer: ${selectedAngle.asset}
- cta: ${selectedAngle.cta}

BACKGROUND SIGNALS:
- legacy issues: ${legacyIssues}
${companyAnalysis.pagespeedScore !== null ? `- mobile performance score: ${companyAnalysis.pagespeedScore}/100` : ''}
${selectedAngle.guidance.map((item) => `- ${item}`).join('\n')}

${customPrompt ? `Extra context: ${customPrompt}` : ''}

The opener line MUST be exactly: "hey ${contact.firstName.toLowerCase()}, ${opener}"
The subject line MUST be exactly: "${subject}"

Do not mention migration, rebuilding, nextjs, react, vue, jquery, wordpress, drupal, php, or frameworks unless there is no other way to be specific.
Do not teach them what the issue is. Ask about the effect on conversions, revenue, speed, ux, or internal update velocity.
Avoid making every email about a performance score. Use the score only if it genuinely helps the hook.
Keep the curiosity opener exactly as given. Do not change it.
The final ask must be screenshots, notes, a teardown, or first fixes, not a project.

Output format (nothing else):
SUBJECT: ${subject}
BODY:
[the full email]`;

  const response = await withRetry(() => generate(prompt, systemPrompt));
  
  // Parse subject and body from response
  const subjectMatch = response.match(/SUBJECT:\s*(.+?)(?:\n|BODY:)/i);
  const bodyMatch = response.match(/BODY:\s*([\s\S]+)/i);

  const parsedSubject = subjectMatch 
    ? subjectMatch[1].trim() 
    : subject;
  
  const body = bodyMatch 
    ? bodyMatch[1].trim() 
    : response;

  // Clean up any leaked format tags from the LLM output
  const cleanBody = body
    .replace(/^BODY:\s*/i, '')
    .replace(/^SUBJECT:.*\n/i, '')
    .replace(/\[line\d*\]/gi, '')
    .replace(/\[Write.*?\]/gi, '')
    .trim();

  const enforcedBody = shouldUseInitialFallback(cleanBody, selectedAngle)
    ? fallbackBody
    : cleanBody;

  return { subject: parsedSubject, body: enforcedBody.toLowerCase() };
}

/**
 * Generate follow-up email
 */
export async function generateFollowupEmail(
  contact: {
    firstName: string;
    lastName: string;
    title: string;
    company: string;
  },
  previousEmail: {
    subject: string;
    body: string;
    sentAt: Date;
  },
  followupNumber: number,
  customPrompt?: string
): Promise<GeneratedEmail> {
  const systemPrompt = `You write follow-up cold emails. These should be SHORTER than the original (under 40 words). The goal is to gently bump without being annoying.

RULES:
- under 40 words. seriously, count them.
- NEVER say "following up", "circling back", "checking in", "just wanted to", "touching base"
- no greetings. no "hey" or "hi". jump straight in.
- no exclamation marks. keep it chill.
- all lowercase except proper nouns.
- come at the problem from a DIFFERENT angle than the first email
- bring one new piece of value, like annotated notes, a teardown, a breakdown, or the first bottlenecks you spotted
- do not pivot into migration or tech-stack talk
- end with a soft question
- sign off with just your name on a new line

EXAMPLES OF GREAT FOLLOW-UPS:

Example 1 (after an email about slow site speed):
SUBJECT: re: quick q
BODY:
i made a note of the first two places the mobile experience feels sticky. want me to send that over?

abdul

Example 2 (after an email about outdated tech):
SUBJECT: one more thing
BODY:
i can send a short teardown of the pages that probably take the most effort to update. want it?

thoughts?
abdul`;

  const daysSince = Math.floor(
    (Date.now() - previousEmail.sentAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  const prompt = `Write follow-up email #${followupNumber}. Follow the system prompt examples EXACTLY in tone.

CONTEXT:
- recipient: ${contact.firstName.toLowerCase()} at ${contact.company}
- original email was sent ${daysSince} days ago
- original subject: ${previousEmail.subject}
- original body (for context, don't repeat it): ${previousEmail.body.substring(0, 200)}...

${customPrompt ? `Extra context: ${customPrompt}` : ''}

Come at the problem from a different angle. Don't rehash the first email.
Offer this new value naturally if it fits: ${previousEmail.body.toLowerCase().includes('mobile') ? 'annotated mobile notes' : 'a short teardown or the first bottlenecks spotted'}.

Output format (nothing else):
SUBJECT: [2-3 lowercase words, or "re: [original subject]"]
BODY:
[the full follow-up email, under 40 words]`;

  const response = await withRetry(() => generate(prompt, systemPrompt));
  
  const subjectMatch = response.match(/SUBJECT:\s*(.+?)(?:\n|BODY:)/i);
  const bodyMatch = response.match(/BODY:\s*([\s\S]+)/i);

  const subject = subjectMatch 
    ? subjectMatch[1].trim() 
    : `re: ${previousEmail.subject}`;
  
  const body = bodyMatch 
    ? bodyMatch[1].trim() 
    : response;

  // Clean up any leaked format tags from the LLM output
  const cleanBody = body
    .replace(/^BODY:\s*/i, '')
    .replace(/^SUBJECT:.*\n/i, '')
    .replace(/^re:.*\n/i, '')
    .trim();

  const followupOffer = previousEmail.body.toLowerCase().includes('mobile')
    ? 'annotated mobile notes'
    : 'a short teardown of the first bottlenecks';

  const enforcedBody = shouldUseFollowupFallback(cleanBody)
    ? buildFollowupFallback(previousEmail.body, followupOffer)
    : cleanBody;

  return { subject: subject.toLowerCase(), body: enforcedBody.toLowerCase() };
}

/**
 * Analyze if a company is a good fit based on their website
 */
export async function analyzeCompanyFit(
  companyInfo: {
    name: string;
    domain: string;
    description?: string;
    techStack: string[];
    legacyReasons: string[];
    pagespeedScore: number | null;
  }
): Promise<{ isGoodFit: boolean; score: number; reasoning: string }> {
  const systemPrompt = `You are an expert at qualifying B2B leads for website modernization services.
Analyze companies to determine if they are good prospects based on:
- Having budget (established business, not startup)
- Having need (legacy tech, poor performance)
- Being reachable (B2B focus, decision makers identifiable)`;

  const prompt = `Analyze this company as a potential lead:
Company: ${companyInfo.name}
Website: ${companyInfo.domain}
Description: ${companyInfo.description || 'Not available'}
Tech Stack: ${companyInfo.techStack.join(', ') || 'Unknown'}
Legacy Issues: ${companyInfo.legacyReasons.join(', ') || 'None detected'}
PageSpeed Score: ${companyInfo.pagespeedScore ?? 'Unknown'}/100

Rate this lead from 1-10 and explain briefly.
Format: SCORE: [1-10]
REASONING: [1-2 sentences]`;

  const response = await withRetry(() => generate(prompt, systemPrompt));
  
  const scoreMatch = response.match(/SCORE:\s*(\d+)/i);
  const reasoningMatch = response.match(/REASONING:\s*(.+)/i);

  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 5;
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : response;

  return {
    isGoodFit: score >= 6,
    score: Math.min(10, Math.max(1, score)),
    reasoning,
  };
}

/**
 * Extract rich company data from scraped website text
 */
export async function enrichCompanyProfile(pageText: string): Promise<EnrichmentData | null> {
  if (!pageText || pageText.length < 50) return null;

  const systemPrompt = `You are an expert B2B business analyst.
Your task is to read the scraped text from a company's website and extract specific business intelligence.
Always return valid JSON matching the exact schema provided. Do not use markdown blocks.`;

  const prompt = `Analyze this website text and extract the following:
1. The company's primary industry (e.g., "Manufacturing", "SaaS", "Hospitality").
2. A concise 1-sentence description of what they actually do.
3. Their primary value proposition (why customers choose them).
4. Who their specific target audience or ICP is.
5. Specific problems they solve for their customers.
6. Likely annual revenue range (estimate based on company size/clues, e.g., "$1M-$5M").
7. Up to 3 likely competitors or alternative solutions in their space.

Website Text:
${pageText.substring(0, 4000)}

Return exact JSON:
{
  "industry": "...",
  "description": "...",
  "value_proposition": "...",
  "target_audience": "...",
  "problems_solved": "...",
  "estimated_revenue": "...",
  "competitors": ["...", "..."]
}`;

  try {
    const rawResponse = await generate(prompt, systemPrompt);
    
    // Attempt to extract JSON if it was wrapped in markdown by mistake
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      industry: parsed.industry || 'Unknown',
      description: parsed.description || 'Unknown',
      value_proposition: parsed.value_proposition || 'Unknown',
      target_audience: parsed.target_audience || 'Unknown',
      problems_solved: parsed.problems_solved || 'Unknown',
      estimated_revenue: parsed.estimated_revenue || 'Unknown',
      competitors: Array.isArray(parsed.competitors) ? parsed.competitors : [],
    };
  } catch (error) {
    console.error('Failed to parse AI enrichment output:', error);
    return null;
  }
}
