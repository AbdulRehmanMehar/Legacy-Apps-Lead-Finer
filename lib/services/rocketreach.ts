/**
 * RocketReach Service - Find decision-makers and their contact information
 * Targets C-Level, VP/Director, and Technical Lead roles
 */

export interface RocketReachPerson {
  id: number;
  name: string;
  first_name: string;
  last_name: string;
  title: string;
  current_employer: string;
  city: string;
  region: string;
  country: string;
  linkedin_url: string;
  emails: Array<{
    email: string;
    type: string;
    is_valid: boolean;
  }>;
  phones: Array<{
    number: string;
    type: string;
  }>;
}

export interface ContactSearchResult {
  contacts: Array<{
    id: string;
    firstName: string;
    lastName: string;
    fullName: string;
    email: string | null;
    emailVerified: boolean;
    phone: string | null;
    linkedinUrl: string | null;
    title: string;
    seniority: string;
    department: string;
    rocketreachId: string;
  }>;
  pagination: {
    start: number;
    total: number;
  };
}

// Target titles for decision makers
const TARGET_TITLES = [
  // C-Level
  'CEO', 'Chief Executive Officer',
  'Owner', 'Founder', 'Co-Founder', 'Co-founder',
  'CTO', 'Chief Technology Officer',
  'CIO', 'Chief Information Officer',
  'CFO', 'Chief Financial Officer',
  'COO', 'Chief Operating Officer',
  'CMO', 'Chief Marketing Officer',
  
  // VP Level
  'VP Engineering', 'Vice President Engineering',
  'VP Technology', 'Vice President Technology',
  'VP IT', 'Vice President IT',
  'VP Information Technology',
  'VP Marketing', 'Vice President Marketing',
  'VP Operations', 'Vice President Operations',
  
  // Director Level
  'Director of Engineering',
  'Director of Technology',
  'Director of IT',
  'Director of Information Technology',
  'Director of Marketing',
  'Director of Digital',
  'IT Director',
  'Technology Director',
  
  // Technical Leads
  'Engineering Manager',
  'IT Manager',
  'Technology Manager',
  'Tech Lead',
  'Head of Engineering',
  'Head of IT',
  'Head of Technology',
];

// Seniority classification
function classifySeniority(title: string): string {
  const lowerTitle = (title || '').toLowerCase();
  
  if (lowerTitle.includes('chief') || lowerTitle.match(/^c[etfimo]o$/i) || 
      lowerTitle.includes('ceo') || lowerTitle.includes('cto') || 
      lowerTitle.includes('cio') || lowerTitle.includes('cfo')) {
    return 'c-level';
  }
  
  if (lowerTitle.includes('vice president') || lowerTitle.includes(' vp ') || 
      lowerTitle.startsWith('vp ')) {
    return 'vp';
  }
  
  if (lowerTitle.includes('director')) {
    return 'director';
  }
  
  if (lowerTitle.includes('manager') || lowerTitle.includes('head of') || 
      lowerTitle.includes('lead')) {
    return 'manager';
  }
  
  return 'other';
}

// Department classification
function classifyDepartment(title: string): string {
  const lowerTitle = (title || '').toLowerCase();
  
  if (lowerTitle.includes('engineer') || lowerTitle.includes('technology') || 
      lowerTitle.includes('tech') || lowerTitle.includes('it ') || 
      lowerTitle.includes('information technology') || lowerTitle.includes('development')) {
    return 'engineering';
  }
  
  if (lowerTitle.includes('marketing') || lowerTitle.includes('digital') || 
      lowerTitle.includes('growth')) {
    return 'marketing';
  }
  
  if (lowerTitle.includes('operations') || lowerTitle.includes('coo')) {
    return 'operations';
  }
  
  if (lowerTitle.includes('finance') || lowerTitle.includes('cfo')) {
    return 'finance';
  }
  
  if (lowerTitle.includes('ceo') || lowerTitle.includes('chief executive')) {
    return 'executive';
  }
  
  return 'other';
}

const API_BASE = 'https://api.rocketreach.co/api/v2';

/**
 * Check if RocketReach API is configured and working
 */
export async function checkRocketReachHealth(): Promise<{ healthy: boolean; error?: string; credits?: number }> {
  const apiKey = process.env.ROCKETREACH_API_KEY;
  
  if (!apiKey) {
    return { healthy: false, error: 'ROCKETREACH_API_KEY not configured' };
  }

  try {
    // Use the correct account lookup endpoint to check health and credits
    const response = await fetch(`${API_BASE}/account`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const error = await response.text();
      // Avoid dumping HTML pages into error messages
      const brief = error.trimStart().startsWith('<')
        ? `HTTP ${response.status} (HTML response - check API key)`
        : error.slice(0, 200);
      return { healthy: false, error: `RocketReach API error: ${brief}` };
    }

    const data = await response.json();
    return { 
      healthy: true, 
      credits: data.lookups_remaining || data.credits_remaining || data.remaining
    };
  } catch (error) {
    return { 
      healthy: false, 
      error: `Cannot connect to RocketReach: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Search for people at a specific company
 */
export async function searchPeopleAtCompany(
  companyName: string,
  domain: string,
  options: {
    titles?: string[];
    limit?: number;
  } = {}
): Promise<ContactSearchResult> {
  const apiKey = process.env.ROCKETREACH_API_KEY;
  
  if (!apiKey) {
    throw new Error('ROCKETREACH_API_KEY not configured');
  }

  const titles = options.titles || TARGET_TITLES;
  const limit = options.limit || 10;

  // STAGE 1: Try with specific target titles
  const query = {
    company_domain: [domain],
    current_title: titles.slice(0, 30),
  };

  try {
    let response = await fetch(`${API_BASE}/person/search`, {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        query,
        page_size: limit 
      }),
    });

    let data = await response.json();
    let profiles: RocketReachPerson[] = data.profiles || [];

    // STAGE 2: Fallback to broad domain search if STAGE 1 yielded nothing
    if (profiles.length === 0 && data.pagination?.total === 0) {
      console.log(`ℹ️ No specific titles found for "${domain}". Falling back to broad domain search...`);
      const fallbackQuery = {
        company_domain: [domain]
      };
      
      response = await fetch(`${API_BASE}/person/search`, {
        method: 'POST',
        headers: {
          'Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          query: fallbackQuery,
          page_size: limit 
        }),
      });
      
      if (response.ok) {
        data = await response.json();
        profiles = data.profiles || [];
        console.log(`ℹ️ Broad search for "${domain}" found ${data.pagination?.total || 0} profiles.`);
      }
    }

    if (!response.ok && profiles.length === 0) {
      console.error(`❌ RocketReach Search API Error [${response.status}]`);
      return { contacts: [], pagination: { start: 0, total: 0 } };
    }

    // Transform to our format
    const contacts = profiles.map(person => {
      const fullName = person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Unknown Contact';
      const parts = fullName.split(' ');
      const fName = person.first_name || parts[0] || '';
      const lName = person.last_name || (parts.length > 1 ? parts.slice(1).join(' ') : '');

      return {
        id: crypto.randomUUID(),
        firstName: fName,
        lastName: lName,
        fullName: fullName,
        email: person.emails?.find(e => e.is_valid)?.email || person.emails?.[0]?.email || null,
        emailVerified: person.emails?.some(e => e.is_valid) || false,
        phone: person.phones?.[0]?.number || null,
        linkedinUrl: person.linkedin_url || null,
        title: person.title || '',
        seniority: classifySeniority(person.title || ''),
        department: classifyDepartment(person.title || ''),
        rocketreachId: String(person.id),
      };
    });

    return {
      contacts,
      pagination: {
        start: data.pagination?.start || 0,
        total: data.pagination?.total || contacts.length,
      },
    };
  } catch (error) {
    console.error('RocketReach API error:', error);
    return { contacts: [], pagination: { start: 0, total: 0 } };
  }
}

/**
 * Lookup a specific person's contact info by RocketReach ID
 */
export async function lookupPerson(rocketreachId: string): Promise<RocketReachPerson | null> {
  const apiKey = process.env.ROCKETREACH_API_KEY;
  
  if (!apiKey) {
    throw new Error('ROCKETREACH_API_KEY not configured');
  }

  try {
    const response = await fetch(`${API_BASE}/person/lookup?id=${rocketreachId}`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('RocketReach lookup error:', error);
    return null;
  }
}

/**
 * Search for a person by name and company
 */
export async function findPersonByName(
  firstName: string,
  lastName: string,
  companyName: string
): Promise<ContactSearchResult> {
  const apiKey = process.env.ROCKETREACH_API_KEY;
  
  if (!apiKey) {
    throw new Error('ROCKETREACH_API_KEY not configured');
  }

  const query = {
    name: [`${firstName} ${lastName}`],
    current_employer: [companyName],
    page_size: 5,
  };

  try {
    const response = await fetch(`${API_BASE}/person/search`, {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      return { contacts: [], pagination: { start: 0, total: 0 } };
    }

    const data = await response.json();
    const profiles: RocketReachPerson[] = data.profiles || [];

    const contacts = profiles.map(person => {
      const fullName = person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Unknown Contact';
      const parts = fullName.split(' ');
      const fName = person.first_name || parts[0] || '';
      const lName = person.last_name || (parts.length > 1 ? parts.slice(1).join(' ') : '');

      return {
        id: crypto.randomUUID(),
        firstName: fName,
        lastName: lName,
        fullName: fullName,
        email: person.emails?.find(e => e.is_valid)?.email || person.emails?.[0]?.email || null,
        emailVerified: person.emails?.some(e => e.is_valid) || false,
        phone: person.phones?.[0]?.number || null,
        linkedinUrl: person.linkedin_url || null,
        title: person.title || '',
        seniority: classifySeniority(person.title || ''),
        department: classifyDepartment(person.title || ''),
        rocketreachId: String(person.id),
      };
    });

    return {
      contacts,
      pagination: {
        start: data.pagination?.start || 0,
        total: data.pagination?.total || contacts.length,
      },
    };
  } catch (error) {
    console.error('RocketReach find person error:', error);
    return { contacts: [], pagination: { start: 0, total: 0 } };
  }
}

/**
 * Get email for a LinkedIn profile URL
 */
export async function getEmailFromLinkedIn(linkedinUrl: string): Promise<{
  email: string | null;
  verified: boolean;
  person: Partial<RocketReachPerson> | null;
}> {
  const apiKey = process.env.ROCKETREACH_API_KEY;
  
  if (!apiKey) {
    throw new Error('ROCKETREACH_API_KEY not configured');
  }

  try {
    const response = await fetch(`${API_BASE}/person/lookup`, {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ linkedin_url: linkedinUrl }),
    });

    if (!response.ok) {
      return { email: null, verified: false, person: null };
    }

    const person: RocketReachPerson = await response.json();
    const verifiedEmail = person.emails?.find(e => e.is_valid);
    
    return {
      email: verifiedEmail?.email || person.emails?.[0]?.email || null,
      verified: !!verifiedEmail,
      person,
    };
  } catch (error) {
    console.error('RocketReach LinkedIn lookup error:', error);
    return { email: null, verified: false, person: null };
  }
}
