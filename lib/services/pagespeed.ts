// Puppeteer-based Page Analysis Service
// Replaces Google PageSpeed API — runs locally with headless Chrome
// Saves a screenshot to public/screenshots/{domain}.jpg

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

export interface PageSpeedResult {
  score: number;
  metrics: {
    firstContentfulPaint: number;
    largestContentfulPaint: number;
    totalBlockingTime: number;
    cumulativeLayoutShift: number;
    speedIndex: number;
    timeToInteractive: number;
  };
  opportunities: Array<{
    id: string;
    title: string;
    description: string;
    savings?: number;
  }>;
  diagnostics: Array<{
    id: string;
    title: string;
    description: string;
  }>;
  screenshotPath?: string;
  rawData: Record<string, unknown>;
}

// Ensure screenshots folder exists
const SCREENSHOTS_DIR = path.join(process.cwd(), 'public', 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function sanitizeDomain(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9.-]/g, '_');
}

/** Launch browser with up to 2 retries — guards against occasional Chromium startup failures */
async function launchBrowser() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--single-process',
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        timeout: 15000,
      });
    } catch (err) {
      if (attempt === 3) throw err;
      console.warn(`[pagespeed] Browser launch attempt ${attempt} failed, retrying...`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error('Failed to launch browser after 3 attempts');
}

export async function analyzePageSpeed(url: string, timeout = 30000): Promise<PageSpeedResult> {
  const targetUrl = url.startsWith('http') ? url : `https://${url}`;
  const domainSlug = sanitizeDomain(targetUrl);
  const screenshotFile = path.join(SCREENSHOTS_DIR, `${domainSlug}.jpg`);
  const screenshotPublicPath = `/screenshots/${domainSlug}.jpg`;

  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();

    // Hard cap: no single page operation can hang longer than the overall timeout
    page.setDefaultNavigationTimeout(timeout);
    page.setDefaultTimeout(timeout);

    // Emulate a mid-tier mobile device for realistic scoring
    await page.emulate({
      viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false },
      userAgent:
        'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    });

    // Enable Chrome DevTools Protocol performance metrics
    const client = await page.createCDPSession();
    await client.send('Performance.enable');

    const startTime = Date.now();

    // Track Web Vitals via JS injection
    await page.evaluateOnNewDocument(() => {
      (window as any).__metrics = { fcp: 0, lcp: 0, cls: 0 };
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.name === 'first-contentful-paint') {
              (window as any).__metrics.fcp = entry.startTime;
            }
          }
        }).observe({ type: 'paint', buffered: true });

        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            (window as any).__metrics.lcp = entries[entries.length - 1].startTime;
          }
        }).observe({ type: 'largest-contentful-paint', buffered: true });

        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as any[]) {
            (window as any).__metrics.cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch (e) {}
    });

    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout,
    });

    // Give observers a moment to collect
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Capture full-page screenshot
    await page.screenshot({
      path: screenshotFile as `${string}.png`,
      fullPage: true,
      type: 'jpeg',
      quality: 70,
    });

    // Read Chrome DevTools metrics
    const cdpMetrics = await client.send('Performance.getMetrics');
    const metricsMap: Record<string, number> = {};
    for (const m of cdpMetrics.metrics) {
      metricsMap[m.name] = m.value;
    }

    // Read JS-injected Web Vitals
    const webVitals = await page.evaluate(() => (window as any).__metrics || {});
    const loadTime = Date.now() - startTime;

    // Retrieve key DOM diagnostics
    const domSize = await page.evaluate(() => document.querySelectorAll('*').length);
    const scriptCount = await page.evaluate(() =>
      document.querySelectorAll('script[src]').length
    );

    // Build normalized metrics (milliseconds)
    const fcp = webVitals.fcp || (metricsMap['FirstMeaningfulPaint'] ? metricsMap['FirstMeaningfulPaint'] * 1000 : 0);
    const lcp = webVitals.lcp || 0;
    const cls = webVitals.cls || 0;
    const scriptDuration = (metricsMap['ScriptDuration'] || 0) * 1000;
    const tbt = Math.max(0, scriptDuration - 50); // Total Blocking Time approximation

    // Compute a composite performance score (0–100)
    // FCP weight: 15%, LCP weight: 25%, TBT weight: 25%, CLS weight: 15%, Load weight: 20%
    const fcpScore = Math.max(0, 100 - Math.floor(fcp / 40));
    const lcpScore = Math.max(0, 100 - Math.floor(lcp / 50));
    const tbtScore = Math.max(0, 100 - Math.floor(tbt / 10));
    const clsScore = Math.max(0, 100 - Math.floor(cls * 1000));
    const loadScore = Math.max(0, 100 - Math.floor(loadTime / 100));

    const score = Math.min(
      100,
      Math.round(
        fcpScore * 0.15 +
        lcpScore * 0.25 +
        tbtScore * 0.25 +
        clsScore * 0.15 +
        loadScore * 0.20
      )
    );

    // Build opportunities list
    const opportunities: PageSpeedResult['opportunities'] = [];
    if (fcp > 2000) opportunities.push({ id: 'slow-fcp', title: 'Slow First Contentful Paint', description: `FCP is ${Math.round(fcp)}ms (good < 1800ms)`, savings: fcp - 1800 });
    if (lcp > 4000) opportunities.push({ id: 'slow-lcp', title: 'Slow Largest Contentful Paint', description: `LCP is ${Math.round(lcp)}ms (good < 2500ms)`, savings: lcp - 2500 });
    if (tbt > 200)  opportunities.push({ id: 'high-tbt', title: 'High Total Blocking Time', description: `TBT is ~${Math.round(tbt)}ms (good < 200ms)` });
    if (cls > 0.10) opportunities.push({ id: 'high-cls', title: 'High Cumulative Layout Shift', description: `CLS is ${cls.toFixed(3)} (good < 0.1)` });

    // Build diagnostics
    const diagnostics: PageSpeedResult['diagnostics'] = [];
    if (domSize > 1500) diagnostics.push({ id: 'large-dom', title: 'Large DOM Size', description: `${domSize} elements (recommended < 1500)` });
    if (scriptCount > 20) diagnostics.push({ id: 'many-scripts', title: 'Excessive Scripts', description: `${scriptCount} external scripts found` });

    return {
      score,
      metrics: {
        firstContentfulPaint: Math.round(fcp),
        largestContentfulPaint: Math.round(lcp),
        totalBlockingTime: Math.round(tbt),
        cumulativeLayoutShift: parseFloat(cls.toFixed(4)),
        speedIndex: Math.round(loadTime),
        timeToInteractive: Math.round(loadTime * 1.2),
      },
      opportunities,
      diagnostics,
      screenshotPath: screenshotPublicPath,
      rawData: {
        cdpMetrics: metricsMap,
        webVitals,
        domSize,
        scriptCount,
        loadTime,
      },
    };
  } finally {
    await browser.close();
  }
}
