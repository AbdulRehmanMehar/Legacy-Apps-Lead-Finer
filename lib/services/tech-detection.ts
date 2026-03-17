// Technology Stack Detection Service
// Uses pattern matching on HTML, headers, and meta tags to detect technologies

export interface TechStackItem {
  name: string;
  category: string;
  version?: string;
  confidence: number; // 0-100
}

export interface TechDetectionResult {
  technologies: TechStackItem[];
  rawHtml?: string;
  pageText?: string;
  headers?: Record<string, string>;
}

// Technology detection patterns
const techPatterns: Array<{
  name: string;
  category: string;
  patterns: Array<{
    type: 'html' | 'header' | 'meta' | 'script' | 'url';
    regex: RegExp;
    versionGroup?: number;
  }>;
}> = [
  // JavaScript Frameworks
  {
    name: 'React',
    category: 'JavaScript Framework',
    patterns: [
      { type: 'html', regex: /react[.-]dom/i },
      { type: 'html', regex: /_react|__REACT/i },
      { type: 'html', regex: /data-reactroot|data-reactid/i },
      { type: 'script', regex: /react\.production\.min\.js/i },
    ],
  },
  {
    name: 'Vue.js',
    category: 'JavaScript Framework',
    patterns: [
      { type: 'html', regex: /vue[.-]?(\d+)?\.(?:min\.)?js/i },
      { type: 'html', regex: /data-v-[a-f0-9]/i },
      { type: 'html', regex: /__VUE__/i },
    ],
  },
  {
    name: 'Angular',
    category: 'JavaScript Framework',
    patterns: [
      { type: 'html', regex: /ng-version="(\d+)/i, versionGroup: 1 },
      { type: 'html', regex: /angular[.-]?(\d+)?\.(?:min\.)?js/i },
      { type: 'html', regex: /ng-app|ng-controller|ng-model/i },
    ],
  },
  {
    name: 'Next.js',
    category: 'JavaScript Framework',
    patterns: [
      { type: 'html', regex: /_next\/static/i },
      { type: 'html', regex: /__NEXT_DATA__/i },
      { type: 'header', regex: /x-nextjs/i },
    ],
  },
  {
    name: 'Nuxt.js',
    category: 'JavaScript Framework',
    patterns: [
      { type: 'html', regex: /_nuxt\//i },
      { type: 'html', regex: /__NUXT__/i },
    ],
  },
  
  // Legacy JavaScript
  {
    name: 'jQuery',
    category: 'JavaScript Library',
    patterns: [
      { type: 'html', regex: /jquery[.-]?(\d+[\d.]*)?(?:\.min)?\.js/i, versionGroup: 1 },
      { type: 'script', regex: /jquery/i },
    ],
  },
  {
    name: 'jQuery UI',
    category: 'JavaScript Library',
    patterns: [
      { type: 'html', regex: /jquery-ui/i },
      { type: 'html', regex: /ui\.jquery\.com/i },
    ],
  },
  {
    name: 'Backbone.js',
    category: 'JavaScript Framework',
    patterns: [
      { type: 'html', regex: /backbone[.-]?(\d+[\d.]*)?(?:\.min)?\.js/i },
    ],
  },
  {
    name: 'Prototype.js',
    category: 'JavaScript Library',
    patterns: [
      { type: 'html', regex: /prototype\.js/i },
    ],
  },
  {
    name: 'MooTools',
    category: 'JavaScript Library',
    patterns: [
      { type: 'html', regex: /mootools/i },
    ],
  },
  
  // CMS
  {
    name: 'WordPress',
    category: 'CMS',
    patterns: [
      { type: 'html', regex: /wp-content|wp-includes/i },
      { type: 'meta', regex: /wordpress/i },
      { type: 'header', regex: /x-powered-by:.*wordpress/i },
    ],
  },
  {
    name: 'Drupal',
    category: 'CMS',
    patterns: [
      { type: 'html', regex: /drupal/i },
      { type: 'html', regex: /sites\/(?:default|all)\/(?:files|themes|modules)/i },
      { type: 'header', regex: /x-drupal/i },
      { type: 'header', regex: /x-generator:.*drupal/i },
    ],
  },
  {
    name: 'Joomla',
    category: 'CMS',
    patterns: [
      { type: 'html', regex: /\/media\/jui\/|\/media\/system\//i },
      { type: 'meta', regex: /joomla/i },
    ],
  },
  {
    name: 'Magento',
    category: 'E-commerce',
    patterns: [
      { type: 'html', regex: /mage\/|magento/i },
      { type: 'html', regex: /skin\/frontend/i },
    ],
  },
  {
    name: 'Shopify',
    category: 'E-commerce',
    patterns: [
      { type: 'html', regex: /cdn\.shopify\.com/i },
      { type: 'html', regex: /Shopify\.theme/i },
    ],
  },
  {
    name: 'Wix',
    category: 'Website Builder',
    patterns: [
      { type: 'html', regex: /wix\.com|wixstatic\.com/i },
    ],
  },
  {
    name: 'Squarespace',
    category: 'Website Builder',
    patterns: [
      { type: 'html', regex: /squarespace/i },
      { type: 'html', regex: /static\.squarespace\.com/i },
    ],
  },
  
  // CSS Frameworks
  {
    name: 'Bootstrap',
    category: 'CSS Framework',
    patterns: [
      { type: 'html', regex: /bootstrap[.-]?(\d+[\d.]*)?(?:\.min)?\.(?:css|js)/i, versionGroup: 1 },
      { type: 'html', regex: /class="[^"]*\b(?:container|row|col-(?:xs|sm|md|lg|xl))/i },
    ],
  },
  {
    name: 'Tailwind CSS',
    category: 'CSS Framework',
    patterns: [
      { type: 'html', regex: /tailwind/i },
      { type: 'html', regex: /class="[^"]*\b(?:flex|grid|bg-|text-|p-|m-)[^"]*"/i },
    ],
  },
  {
    name: 'Foundation',
    category: 'CSS Framework',
    patterns: [
      { type: 'html', regex: /foundation[.-]?(\d+[\d.]*)?(?:\.min)?\.(?:css|js)/i },
    ],
  },
  
  // Server Technologies
  {
    name: 'PHP',
    category: 'Server',
    patterns: [
      { type: 'header', regex: /x-powered-by:.*php\/(\d+[\d.]*)/i, versionGroup: 1 },
      { type: 'url', regex: /\.php(?:\?|$)/i },
    ],
  },
  {
    name: 'ASP.NET',
    category: 'Server',
    patterns: [
      { type: 'header', regex: /x-powered-by:.*asp\.net/i },
      { type: 'header', regex: /x-aspnet-version/i },
      { type: 'url', regex: /\.aspx?(?:\?|$)/i },
    ],
  },
  {
    name: 'Node.js',
    category: 'Server',
    patterns: [
      { type: 'header', regex: /x-powered-by:.*express/i },
    ],
  },
  
  // Web Servers
  {
    name: 'Nginx',
    category: 'Web Server',
    patterns: [
      { type: 'header', regex: /server:.*nginx/i },
    ],
  },
  {
    name: 'Apache',
    category: 'Web Server',
    patterns: [
      { type: 'header', regex: /server:.*apache/i },
    ],
  },
  {
    name: 'IIS',
    category: 'Web Server',
    patterns: [
      { type: 'header', regex: /server:.*microsoft-iis/i },
    ],
  },
  
  // CDN/Hosting
  {
    name: 'Cloudflare',
    category: 'CDN',
    patterns: [
      { type: 'header', regex: /cf-ray/i },
      { type: 'header', regex: /server:.*cloudflare/i },
    ],
  },
  {
    name: 'Vercel',
    category: 'Hosting',
    patterns: [
      { type: 'header', regex: /x-vercel/i },
      { type: 'header', regex: /server:.*vercel/i },
    ],
  },
  {
    name: 'Netlify',
    category: 'Hosting',
    patterns: [
      { type: 'header', regex: /x-nf-request-id/i },
      { type: 'header', regex: /server:.*netlify/i },
    ],
  },
  {
    name: 'AWS',
    category: 'Hosting',
    patterns: [
      { type: 'header', regex: /x-amz-|x-amzn-/i },
      { type: 'header', regex: /server:.*amazons3|awselb/i },
    ],
  },
  
  // Analytics
  {
    name: 'Google Analytics',
    category: 'Analytics',
    patterns: [
      { type: 'html', regex: /google-analytics\.com\/(?:ga|analytics)\.js/i },
      { type: 'html', regex: /googletagmanager\.com/i },
      { type: 'html', regex: /gtag\(|ga\('create'/i },
    ],
  },
  {
    name: 'Hotjar',
    category: 'Analytics',
    patterns: [
      { type: 'html', regex: /hotjar\.com/i },
      { type: 'html', regex: /hj\s*\(\s*['"]identify/i },
    ],
  },
  
  // Legacy Indicators
  {
    name: 'Flash',
    category: 'Legacy',
    patterns: [
      { type: 'html', regex: /\.swf['">\s]/i },
      { type: 'html', regex: /shockwave-flash/i },
    ],
  },
  {
    name: 'Silverlight',
    category: 'Legacy',
    patterns: [
      { type: 'html', regex: /silverlight/i },
      { type: 'html', regex: /\.xap['">\s]/i },
    ],
  },
];

export async function detectTechStack(url: string, options?: { signal?: AbortSignal }): Promise<TechDetectionResult> {
  const isHttp = url.startsWith('http');
  const targetUrl = isHttp ? url : `https://${url}`;
  
  let response: Response;
  try {
    response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
      signal: options?.signal,
    });
  } catch (err: any) {
    if (!isHttp && targetUrl.startsWith('https://')) {
      // Retry with HTTP if HTTPS fails (common for legacy sites)
      console.log(`   [tech-detection] HTTPS failed for ${url}, retrying with HTTP...`);
      const httpUrl = `http://${url}`;
      response = await fetch(httpUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'follow',
        signal: options?.signal,
      });
    } else {
      throw err;
    }
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const html = await response.text();
  const headers: Record<string, string> = {};
  
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const headerString = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const technologies: TechStackItem[] = [];
  const detected = new Set<string>();

  // Check each technology
  for (const tech of techPatterns) {
    let maxConfidence = 0;
    let detectedVersion: string | undefined;

    for (const pattern of tech.patterns) {
      let source = '';
      
      switch (pattern.type) {
        case 'html':
        case 'script':
        case 'meta':
          source = html;
          break;
        case 'header':
          source = headerString;
          break;
        case 'url':
          source = targetUrl;
          break;
      }

      const match = source.match(pattern.regex);
      if (match) {
        maxConfidence = Math.max(maxConfidence, 80);
        
        if (pattern.versionGroup && match[pattern.versionGroup]) {
          detectedVersion = match[pattern.versionGroup];
          maxConfidence = 100;
        }
      }
    }

    if (maxConfidence > 0 && !detected.has(tech.name)) {
      detected.add(tech.name);
      technologies.push({
        name: tech.name,
        category: tech.category,
        version: detectedVersion,
        confidence: maxConfidence,
      });
    }
  }

  // Sort by confidence
  technologies.sort((a, b) => b.confidence - a.confidence);

  // Extract visible text for AI enrichment (removing scripts, styles, and HTML tags)
  let pageText = '';
  try {
    // 1. Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/im);
    if (titleMatch && titleMatch[1]) {
      pageText += titleMatch[1].trim() + '\n\n';
    }

    // 2. Extract meta description
    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/im) || 
                          html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/im);
    if (metaDescMatch && metaDescMatch[1]) {
      pageText += metaDescMatch[1].trim() + '\n\n';
    }

    // 3. Extract body text
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/im);
    if (bodyMatch && bodyMatch[1]) {
      let bodyHtml = bodyMatch[1];
      
      // Remove script and style tags completely
      bodyHtml = bodyHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
      bodyHtml = bodyHtml.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
      bodyHtml = bodyHtml.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ');
      
      // Remove all remaining HTML tags
      let text = bodyHtml.replace(/<[^>]+>/g, ' ');

      // Decode basic HTML entities
      text = text.replace(/&nbsp;/g, ' ')
                 .replace(/&amp;/g, '&')
                 .replace(/&lt;/g, '<')
                 .replace(/&gt;/g, '>')
                 .replace(/&quot;/g, '"')
                 .replace(/&#39;/g, "'");

      // Condense whitespace and keep it under a reasonable token limit (~3000 words max)
      text = text.replace(/\s+/g, ' ').trim().slice(0, 15000);
      pageText += text;
    }
  } catch (e) {
    console.error(`   [tech-detection] Error extracting text from ${url}:`, e);
  }

  return {
    technologies,
    headers,
    pageText,
  };
}

// Utility to check if a tech item is considered legacy
export function isLegacyTech(tech: TechStackItem): { isLegacy: boolean; reason?: string } {
  const legacyChecks: Array<{
    name: string;
    check: (tech: TechStackItem) => boolean;
    reason: string;
  }> = [
    {
      name: 'jQuery',
      check: (t) => t.name === 'jQuery',
      reason: 'Uses jQuery without modern framework',
    },
    {
      name: 'Drupal',
      check: (t) => t.name === 'Drupal' && (!t.version || parseInt(t.version) < 9),
      reason: 'Uses Drupal 7/8 (legacy version)',
    },
    {
      name: 'WordPress',
      check: (t) => t.name === 'WordPress' && !!t.version && parseFloat(t.version) < 5,
      reason: 'Uses outdated WordPress version',
    },
    {
      name: 'Bootstrap',
      check: (t) => t.name === 'Bootstrap' && !!t.version && parseInt(t.version) < 4,
      reason: 'Uses Bootstrap 2/3 (legacy version)',
    },
    {
      name: 'PHP',
      check: (t) => t.name === 'PHP' && !!t.version && parseFloat(t.version) < 7.4,
      reason: 'Uses outdated PHP version',
    },
    {
      name: 'ASP.NET',
      check: (t) => t.name === 'ASP.NET',
      reason: 'Uses classic ASP.NET (potential modernization opportunity)',
    },
    {
      name: 'Flash',
      check: (t) => t.name === 'Flash',
      reason: 'Uses Flash (deprecated technology)',
    },
    {
      name: 'Silverlight',
      check: (t) => t.name === 'Silverlight',
      reason: 'Uses Silverlight (deprecated technology)',
    },
    {
      name: 'Backbone.js',
      check: (t) => t.name === 'Backbone.js',
      reason: 'Uses Backbone.js (legacy framework)',
    },
    {
      name: 'Prototype.js',
      check: (t) => t.name === 'Prototype.js',
      reason: 'Uses Prototype.js (legacy library)',
    },
    {
      name: 'MooTools',
      check: (t) => t.name === 'MooTools',
      reason: 'Uses MooTools (legacy library)',
    },
    {
      name: 'Angular',
      check: (t) => t.name === 'Angular' && !!t.version && parseInt(t.version) < 2,
      reason: 'Uses AngularJS 1.x (legacy version)',
    },
  ];

  for (const check of legacyChecks) {
    if (check.check(tech)) {
      return { isLegacy: true, reason: check.reason };
    }
  }

  return { isLegacy: false };
}
