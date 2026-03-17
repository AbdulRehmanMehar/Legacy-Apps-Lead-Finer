import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Company } from '@/lib/models';
import { analyzeCompany, formatAnalysisForStorage } from '@/lib/services/company-analyzer';

// POST /api/analyze - Analyze a domain directly (without creating a company first)
export async function POST(request: NextRequest) {
  await dbConnect();

  try {
    const body = await request.json();
    const { domain, saveAsLead = true } = body;

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 });
    }

    // Clean the domain
    const cleanDomain = domain
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];

    // Run analysis
    const analysis = await analyzeCompany(cleanDomain, {
      skipPageSpeed: false,
      timeout: 60000,
    });

    // If saveAsLead is true and the site is legacy, save to database
    let savedCompany = null;
    if (saveAsLead) {
      const storageData = formatAnalysisForStorage(analysis);

      // Check if already exists
      const existing = await Company.findOne({ domain: cleanDomain });

      if (existing) {
        // Update existing record
        existing.tech_stack = storageData.tech_stack as any;
        existing.pagespeed_score = storageData.pagespeed_score ?? undefined;
        existing.pagespeed_data = storageData.pagespeed_data ?? undefined;
        existing.is_legacy = storageData.is_legacy;
        existing.legacy_reasons = storageData.legacy_reasons;
        existing.analyzed_at = storageData.analyzed_at as any;
        
        await existing.save();
        savedCompany = existing;
      } else {
        // Create new record
        savedCompany = await Company.create({
          domain: cleanDomain,
          tech_stack: storageData.tech_stack,
          pagespeed_score: storageData.pagespeed_score ?? undefined,
          pagespeed_data: storageData.pagespeed_data ?? undefined,
          is_legacy: storageData.is_legacy,
          legacy_reasons: storageData.legacy_reasons,
          analyzed_at: storageData.analyzed_at,
        });
      }
    }

    return NextResponse.json({
      domain: cleanDomain,
      analysis: {
        techStack: analysis.techStack.technologies,
        pageSpeed: analysis.pageSpeed
          ? {
              score: analysis.pageSpeed.score,
              metrics: analysis.pageSpeed.metrics,
              opportunities: analysis.pageSpeed.opportunities.slice(0, 5),
            }
          : null,
        legacyAnalysis: analysis.legacyAnalysis,
        errors: analysis.errors,
      },
      company: savedCompany,
      savedAsLead: !!savedCompany,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
