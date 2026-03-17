// Company Analyzer Service
// Orchestrates tech detection, PageSpeed analysis, and legacy detection

import { analyzePageSpeed, type PageSpeedResult } from './pagespeed';
import { detectTechStack, type TechDetectionResult } from './tech-detection';
import { analyzeLegacyIndicators, type LegacyAnalysis } from './legacy-detector';

export interface CompanyAnalysis {
  domain: string;
  url: string;
  techStack: TechDetectionResult;
  pageSpeed: PageSpeedResult | null;
  legacyAnalysis: LegacyAnalysis;
  pageText?: string;
  screenshotPath?: string;
  analyzedAt: Date;
  errors: string[];
}

export async function analyzeCompany(
  domain: string,
  options: {
    skipPageSpeed?: boolean;
    timeout?: number;
  } = {}
): Promise<CompanyAnalysis> {
  const { skipPageSpeed = false, timeout = 30000 } = options;
  const url = domain.startsWith('http') ? domain : `https://${domain}`;
  const errors: string[] = [];

  // Initialize results
  let techStack: TechDetectionResult = { technologies: [] };
  let pageSpeed: PageSpeedResult | null = null;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Run tech detection
    try {
      techStack = await detectTechStack(url, { signal: controller.signal });
    } catch (error) {
      errors.push(`Tech detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Run PageSpeed analysis (can be slow)
    if (!skipPageSpeed) {
      try {
        pageSpeed = await analyzePageSpeed(url, timeout);
      } catch (error) {
        errors.push(`PageSpeed analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  // Analyze legacy indicators
  const legacyAnalysis = analyzeLegacyIndicators(
    techStack.technologies,
    pageSpeed || undefined
  );

  return {
    domain: domain.replace(/^https?:\/\//, '').replace(/^www\./, ''),
    url,
    techStack,
    pageSpeed,
    legacyAnalysis,
    pageText: techStack.pageText,
    screenshotPath: pageSpeed?.screenshotPath,
    analyzedAt: new Date(),
    errors,
  };
}

// Batch analyze multiple domains
export async function analyzeCompanies(
  domains: string[],
  options: {
    skipPageSpeed?: boolean;
    concurrency?: number;
    onProgress?: (completed: number, total: number, domain: string) => void;
  } = {}
): Promise<Map<string, CompanyAnalysis>> {
  const { concurrency = 3, onProgress } = options;
  const results = new Map<string, CompanyAnalysis>();
  const queue = [...domains];
  let completed = 0;

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const domain = queue.shift();
      if (!domain) break;

      try {
        const analysis = await analyzeCompany(domain, options);
        results.set(domain, analysis);
      } catch (error) {
        results.set(domain, {
          domain,
          url: `https://${domain}`,
          techStack: { technologies: [] },
          pageSpeed: null,
          legacyAnalysis: { isLegacy: false, score: 0, reasons: [], recommendations: [] },
          analyzedAt: new Date(),
          errors: [error instanceof Error ? error.message : 'Analysis failed'],
        });
      }

      completed++;
      onProgress?.(completed, domains.length, domain);
    }
  }

  // Run concurrent workers
  const workers = Array(Math.min(concurrency, domains.length))
    .fill(null)
    .map(() => processNext());

  await Promise.all(workers);

  return results;
}

// Format analysis for storage
export function formatAnalysisForStorage(analysis: CompanyAnalysis) {
  return {
    domain: analysis.domain,
    tech_stack: analysis.techStack.technologies,
    pagespeed_score: analysis.pageSpeed?.score || null,
    pagespeed_data: analysis.pageSpeed
      ? {
          performanceScore: analysis.pageSpeed.score,
          firstContentfulPaint: analysis.pageSpeed.metrics.firstContentfulPaint,
          largestContentfulPaint: analysis.pageSpeed.metrics.largestContentfulPaint,
          totalBlockingTime: analysis.pageSpeed.metrics.totalBlockingTime,
          cumulativeLayoutShift: analysis.pageSpeed.metrics.cumulativeLayoutShift,
          speedIndex: analysis.pageSpeed.metrics.speedIndex,
        }
      : null,
    is_legacy: analysis.legacyAnalysis.isLegacy,
    legacy_reasons: analysis.legacyAnalysis.reasons,
    pageText: analysis.pageText,
    screenshot_path: analysis.screenshotPath,
    analyzed_at: analysis.analyzedAt.toISOString(),
    last_error: analysis.errors.length > 0 ? analysis.errors.join(' | ') : undefined,
  };
}
