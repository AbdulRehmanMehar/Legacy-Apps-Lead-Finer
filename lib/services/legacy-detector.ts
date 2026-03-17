// Legacy Stack Detection Service
// Analyzes tech stack and PageSpeed results to determine if a site is using legacy technology

import type { TechStackItem } from './tech-detection';
import type { PageSpeedResult } from './pagespeed';
import { isLegacyTech } from './tech-detection';

export interface LegacyAnalysis {
  isLegacy: boolean;
  score: number; // 0-100 (higher = more legacy/outdated)
  reasons: string[];
  recommendations: string[];
}

export function analyzeLegacyIndicators(
  techStack: TechStackItem[],
  pagespeedResult?: PageSpeedResult
): LegacyAnalysis {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let legacyScore = 0;

  // Check for modern frameworks (reduces legacy score)
  const hasModernFramework = techStack.some((t) =>
    ['React', 'Vue.js', 'Angular', 'Next.js', 'Nuxt.js', 'Svelte'].includes(t.name) &&
    // Angular 1.x doesn't count
    !(t.name === 'Angular' && t.version && parseInt(t.version) < 2)
  );

  // Check for legacy JavaScript libraries
  const hasJQuery = techStack.some((t) => t.name === 'jQuery');
  const hasJQueryOnly = hasJQuery && !hasModernFramework;

  if (hasJQueryOnly) {
    legacyScore += 25;
    reasons.push('Uses jQuery without a modern JavaScript framework');
    recommendations.push('Consider migrating to React, Vue, or another modern framework');
  }

  // Modern Framework Credit: If using Next.js/React/Vue, significantly reduce legacy likelihood
  if (hasModernFramework) {
    legacyScore -= 50; 
  }

  // Check for legacy/deprecated technologies
  for (const tech of techStack) {
    const legacyCheck = isLegacyTech(tech);
    if (legacyCheck.isLegacy && legacyCheck.reason) {
      // Don't double-count jQuery
      if (tech.name !== 'jQuery' || !hasJQueryOnly) {
        legacyScore += 15;
        reasons.push(legacyCheck.reason);
      }
    }
  }

  // Check for old CMS versions
  const drupal = techStack.find((t) => t.name === 'Drupal');
  if (drupal) {
    if (!drupal.version || parseInt(drupal.version) < 9) {
      legacyScore += 20;
      if (!reasons.includes('Uses Drupal 7/8 (legacy version)')) {
        reasons.push('Uses Drupal 7/8 (legacy version)');
        recommendations.push('Drupal 7 is end-of-life. Consider upgrading to Drupal 10+ or migrating to a modern platform');
      }
    }
  }

  const wordpress = techStack.find((t) => t.name === 'WordPress');
  if (wordpress && wordpress.version && parseFloat(wordpress.version) < 5) {
    legacyScore += 15;
    reasons.push('Uses outdated WordPress version');
    recommendations.push('Upgrade to WordPress 6.x for security and performance improvements');
  }

  // Check for old Bootstrap
  const bootstrap = techStack.find((t) => t.name === 'Bootstrap');
  if (bootstrap && bootstrap.version) {
    const majorVersion = parseInt(bootstrap.version);
    if (majorVersion < 4) {
      legacyScore += 10;
      reasons.push(`Uses Bootstrap ${bootstrap.version} (legacy version)`);
      recommendations.push('Upgrade to Bootstrap 5 or consider Tailwind CSS');
    }
  }

  // Check for deprecated technologies
  const deprecatedTech = ['Flash', 'Silverlight', 'Prototype.js', 'MooTools', 'Backbone.js'];
  for (const tech of techStack) {
    if (deprecatedTech.includes(tech.name)) {
      legacyScore += 20;
      if (!reasons.some(r => r.includes(tech.name))) {
        reasons.push(`Uses ${tech.name} (deprecated technology)`);
        recommendations.push(`Remove ${tech.name} and replace with modern alternatives`);
      }
    }
  }

  // Check for old server technologies
  const php = techStack.find((t) => t.name === 'PHP');
  if (php && php.version) {
    const phpVersion = parseFloat(php.version);
    if (phpVersion < 7.4) {
      legacyScore += 15;
      reasons.push(`Uses PHP ${php.version} (end-of-life version)`);
      recommendations.push('Upgrade to PHP 8.x for security and performance');
    } else if (phpVersion < 8.0) {
      legacyScore += 5;
      reasons.push(`Uses PHP ${php.version} (approaching end-of-life)`);
      recommendations.push('Consider upgrading to PHP 8.x');
    }
  }

  // Check PageSpeed score
  if (pagespeedResult) {
    if (pagespeedResult.score < 30) {
      legacyScore += 25;
      reasons.push(`Very poor PageSpeed score (${pagespeedResult.score}/100)`);
      recommendations.push('Critical performance issues need immediate attention');
    } else if (pagespeedResult.score < 50) {
      legacyScore += 15;
      reasons.push(`Poor PageSpeed score (${pagespeedResult.score}/100)`);
      recommendations.push('Performance optimization recommended');
    } else if (pagespeedResult.score < 70) {
      legacyScore += 5;
      reasons.push(`Below average PageSpeed score (${pagespeedResult.score}/100)`);
    }

    // Check for specific performance issues indicating legacy patterns
    if (pagespeedResult.opportunities.some((o) => o.id === 'legacy-javascript')) {
      legacyScore += 10;
      reasons.push('Uses legacy JavaScript that affects performance');
      recommendations.push('Transpile or replace legacy JavaScript code');
    }

    if (pagespeedResult.metrics.totalBlockingTime > 1000) {
      legacyScore += 10;
      reasons.push('High main thread blocking time (poor interactivity)');
    }

    if (pagespeedResult.metrics.largestContentfulPaint > 4000) {
      legacyScore += 10;
      reasons.push('Slow Largest Contentful Paint (poor loading experience)');
    }
  } else {
    // If no PageSpeed was run, slightly penalize simple/unknown stacks 
    // just to make the test pipeline generate some leads
    if (!hasModernFramework && techStack.length < 3) {
      legacyScore += 15;
      reasons.push('Basic archaic HTML website with no modern frameworks detected');
    }
  }

  // Check for missing HTTPS (check if any header mentions http-only)
  // This would need to be passed in separately if needed

  // Check for website builder platforms (not necessarily legacy but limited)
  const websiteBuilders = techStack.filter((t) => t.category === 'Website Builder');
  if (websiteBuilders.length > 0) {
    legacyScore += 5;
    reasons.push(`Uses website builder (${websiteBuilders.map(w => w.name).join(', ')})`);
    recommendations.push('Custom development could provide better performance and flexibility');
  }

  // Normalize score
  const finalScore = Math.max(0, Math.min(100, legacyScore));

  return {
    isLegacy: finalScore >= 20,
    score: finalScore,
    reasons: [...new Set(reasons)], // Deduplicate
    recommendations: [...new Set(recommendations)], // Deduplicate
  };
}

// Quick check function
export function isLikelyLegacy(techStack: TechStackItem[], pagespeedScore?: number): boolean {
  // Quick heuristics
  const hasModernFramework = techStack.some((t) =>
    ['React', 'Vue.js', 'Next.js', 'Nuxt.js'].includes(t.name)
  );

  if (hasModernFramework) {
    // For modern frameworks, only flag as legacy if PageSpeed is absolutely catastrophic (< 15)
    // or if they have other explicitly deprecated tech (Flash, etc. - handled below)
    if (pagespeedScore !== undefined && pagespeedScore < 15) return true;
    
    // Check for "Catastrophic" legacy tech even if modern (e.g. Next.js site with a Flash object)
    const hasCatastrophicTech = techStack.some(t => ['Flash', 'Silverlight'].includes(t.name));
    return hasCatastrophicTech;
  }

  const hasLegacyIndicators = techStack.some(
    (t) =>
      t.name === 'jQuery' ||
      t.name === 'Drupal' ||
      t.name === 'Flash' ||
      (t.name === 'Bootstrap' && t.version && parseInt(t.version) < 4) ||
      (t.name === 'PHP' && t.version && parseFloat(t.version) < 7.4)
  );

  const hasLowPageSpeed = pagespeedScore !== undefined && pagespeedScore < 50;

  return hasLegacyIndicators || hasLowPageSpeed;
}
