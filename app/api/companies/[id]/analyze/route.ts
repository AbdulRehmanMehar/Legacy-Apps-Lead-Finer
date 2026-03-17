import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Company } from '@/lib/models';
import { analyzeCompany, formatAnalysisForStorage } from '@/lib/services/company-analyzer';

// POST /api/companies/[id]/analyze - Analyze a company's website
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await dbConnect();
  const { id } = await params;

  try {
    // Get the company
    const company = await Company.findById(id);

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Run analysis
    const analysis = await analyzeCompany(company.domain, {
      skipPageSpeed: false,
      timeout: 60000, // 60 seconds
    });

    // Format for storage
    const storageData = formatAnalysisForStorage(analysis);

    // Update the company record
    company.tech_stack = storageData.tech_stack as any;
    company.pagespeed_score = storageData.pagespeed_score ?? undefined;
    company.pagespeed_data = storageData.pagespeed_data ?? undefined;
    company.is_legacy = storageData.is_legacy;
    company.legacy_reasons = storageData.legacy_reasons;
    company.analyzed_at = storageData.analyzed_at as any;
    
    await company.save();

    return NextResponse.json({
      company,
      analysis: {
        techStack: analysis.techStack.technologies,
        pageSpeed: analysis.pageSpeed
          ? {
              score: analysis.pageSpeed.score,
              metrics: analysis.pageSpeed.metrics,
            }
          : null,
        legacyAnalysis: analysis.legacyAnalysis,
        errors: analysis.errors,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
