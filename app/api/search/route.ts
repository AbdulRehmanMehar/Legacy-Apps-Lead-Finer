import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Company, SearchJob, AnalysisQueueItem } from '@/lib/models';
import { discoverLeads, LEGACY_TECH_MAP } from '@/lib/services/discovery';

// POST /api/search - Discover companies using legacy tech and add them to the database
export async function POST(request: NextRequest) {
  await dbConnect();

  try {
    const body = await request.json();
    const { query, autoAnalyze = false } = body;

    if (!query) {
      return NextResponse.json({ error: 'A technology name is required (e.g. "Drupal 7")' }, { status: 400 });
    }

    // Match the query to a known legacy tech key (case-insensitive)
    const tech = Object.keys(LEGACY_TECH_MAP).find(
      k => k.toLowerCase() === query.toLowerCase()
    ) || query;

    // Create a search job record
    const job = await SearchJob.create({
      query: tech,
      status: 'running',
    });

    try {
      // Run dual-source discovery (PublicWWW + CommonCrawl in parallel)
      const { domains, sources } = await discoverLeads(tech, 30);

      const addedCompanies = [];
      const skippedDomains = [];

      for (const domain of domains) {
        const existing = await Company.findOne({ domain }).select('id');

        if (existing) {
          skippedDomains.push(domain);
          continue;
        }

        try {
          const company = await Company.create({
            domain,
            name: domain,
            search_query: tech,
          });

          addedCompanies.push(company);

          if (autoAnalyze) {
            await AnalysisQueueItem.create({
              company_id: company._id.toString(),
              domain: company.domain,
              status: 'pending',
            });
          }
        } catch (insertError) {
          console.error(`Failed to insert company ${domain}:`, insertError);
        }
      }

      job.status = 'completed';
      job.results_count = domains.length;
      job.leads_found = addedCompanies.length;
      job.completed_at = new Date();
      await job.save();

      return NextResponse.json({
        job,
        results: {
          totalFound: domains.length,
          companiesAdded: addedCompanies.length,
          companiesSkipped: skippedDomains.length,
          sources,
        },
        companies: addedCompanies,
      });
    } catch (searchError) {
      job.status = 'failed';
      job.error = searchError instanceof Error ? searchError.message : 'Discovery failed';
      job.completed_at = new Date();
      await job.save();
      throw searchError;
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Discovery failed' },
      { status: 500 }
    );
  }
}

// GET /api/search - Get search job history
export async function GET(request: NextRequest) {
  await dbConnect();
  const searchParams = request.nextUrl.searchParams;
  
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const offset = (page - 1) * limit;

  try {
    const [data, count] = await Promise.all([
      SearchJob.find().sort({ created_at: -1 }).skip(offset).limit(limit),
      SearchJob.countDocuments()
    ]);

    return NextResponse.json({
      jobs: data,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch search jobs' },
      { status: 500 }
    );
  }
}
