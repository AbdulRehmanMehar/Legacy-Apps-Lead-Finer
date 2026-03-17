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
- one specific problem per email. don't list multiple issues. be slightly vague, not a know-it-all.
- the email should feel like you're texting someone you met at a conference last month.

structure (separated by blank lines):
1. opener: one casual sentence. provided for you - use it exactly as given.
2. poke the bear: 1-2 sentences. mention their site naturally. ask a genuine question about one specific problem you noticed. be curious, not preachy.
3. proof: 1 sentence. casually mention a result you got for someone similar. keep it vague enough to be believable.
4. cta + name: a short casual question (like "worth a look?" or "thoughts?") then your name on the next line.

examples of great emails:

example 1:
subject: random thought
body:
hey sarah, this might sound random.

noticed acme's site still runs on jquery. does that ever cause headaches when you're trying to push updates? feels like it'd slow the team down.

we helped a lifestyle brand in a similar spot cut their dev time in half after a rebuild.

worth a look?
abdul

example 2:
subject: quick q
body:
hey mike, had a random thought.

was looking at brightstar's site and it took about 5 seconds to load on my phone. curious if that's been hurting conversions or if it hasn't really come up yet?

helped a similar sized company get their load time under 2 seconds last quarter.

thoughts?
abdul

example 3:
subject: quick thing
body:
hey lisa, honest question.

poked around dataflow's site and noticed it's still running on silverstripe. ever worry about security gaps or is it just something the team maintains for now?

just moved a similar setup over to nextjs and their page speed jumped from 30 to 90.

worth exploring?
abdul`;

  const legacyIssues = companyAnalysis.legacyReasons.length > 0
    ? companyAnalysis.legacyReasons.slice(0, 3).join(', ')
    : 'potential performance improvements';

  const techInfo = companyAnalysis.techStack.length > 0
    ? `Current tech: ${companyAnalysis.techStack.slice(0, 5).join(', ')}`
    : '';

  const speedInfo = companyAnalysis.pagespeedScore !== null
    ? `PageSpeed score: ${companyAnalysis.pagespeedScore}/100`
    : '';

  const curiosityOpeners = [
    "had a random thought.",
    "quick one.",
    "this might be out of left field.",
    "weird timing but had a thought.",
    "random one for you.",
    "been meaning to ask you something.",
    "random one.",
    "quick q.",
    "something came to mind.",
    "honest question.",
    "this might sound random.",
  ];
  const opener = curiosityOpeners[Math.floor(Math.random() * curiosityOpeners.length)];

  const subjectLines = [
    "random thought",
    "quick q",
    "hey",
    "quick thing",
    "random idea",
    "thought of you",
    "quick one",
  ];
  const subject = subjectLines[Math.floor(Math.random() * subjectLines.length)];

  const prompt = `Write a cold email for this lead. Follow the system prompt examples EXACTLY in tone and structure.

LEAD INFO:
- first name: ${contact.firstName.toLowerCase()}
- title: ${contact.title}
- company: ${contact.company}
- website: ${companyAnalysis.domain}

WHAT'S WRONG WITH THEIR SITE (pick ONE to write about):
- ${legacyIssues}
${techInfo ? `- ${techInfo}` : ''}
${speedInfo ? `- ${speedInfo}` : ''}

${customPrompt ? `Extra context: ${customPrompt}` : ''}

The opener line MUST be exactly: "hey ${contact.firstName.toLowerCase()}, ${opener}"
The subject line MUST be exactly: "${subject}"

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

  return { subject: parsedSubject, body: cleanBody.toLowerCase() };
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
- end with a soft question
- sign off with just your name on a new line

EXAMPLES OF GREAT FOLLOW-UPS:

Example 1 (after an email about slow site speed):
SUBJECT: re: quick q
BODY:
forgot to mention - we put together a free breakdown of what's slowing things down for sites like yours. want me to send it over?

abdul

Example 2 (after an email about outdated tech):
SUBJECT: one more thing
BODY:
was thinking about this more. if the old setup isn't causing problems yet, it probably will when traffic picks up. happy to share what we've seen.

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

  return { subject: subject.toLowerCase(), body: cleanBody.toLowerCase() };
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
