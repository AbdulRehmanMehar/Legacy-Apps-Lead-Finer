import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Company, SearchJob } from '@/lib/models';

// GET /api/stats - Get dashboard statistics
export async function GET() {
  await dbConnect();

  try {
    // Aggregation for main company stats
    const [overviewStats] = await Company.aggregate([
      {
        $facet: {
          total: [{ $count: 'count' }],
          legacy: [{ $match: { is_legacy: true } }, { $count: 'count' }],
          analyzed: [{ $match: { analyzed_at: { $exists: true, $ne: null } } }, { $count: 'count' }],
          verifiedCompanies: [
            {
              $match: {
                contacts: {
                  $elemMatch: {
                    email: { $exists: true, $ne: null },
                    verificationStatus: 'verified',
                    emailProviderVerified: true,
                    deliveryStatus: { $ne: 'bounced' },
                  },
                },
              },
            },
            { $count: 'count' }
          ],
          sentCompanies: [
            { $match: { contacts: { $elemMatch: { drafts: { $elemMatch: { sent_at: { $exists: true, $ne: null } } } } } } },
            { $count: 'count' }
          ],
          statusCounts: [
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ],
          pageSpeed: [
            { $match: { pagespeed_score: { $exists: true, $ne: null } } },
            { $group: { _id: null, avg: { $avg: '$pagespeed_score' } } }
          ],
          legacyReasons: [
            { $match: { is_legacy: true } },
            { $unwind: '$legacy_reasons' },
            { $group: { _id: '$legacy_reasons', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
          ]
        }
      }
    ]);

    const totalCompanies = overviewStats.total[0]?.count || 0;
    const legacyCompanies = overviewStats.legacy[0]?.count || 0;
    const analyzedCompanies = overviewStats.analyzed[0]?.count || 0;
    const verifiedCompanies = overviewStats.verifiedCompanies[0]?.count || 0;
    const sentCompanies = overviewStats.sentCompanies[0]?.count || 0;
    const avgPageSpeed = overviewStats.pageSpeed[0]?.avg ? Math.round(overviewStats.pageSpeed[0].avg) : null;

    const statusBreakdown: Record<string, number> = {
      new: 0,
      contacted: 0,
      qualified: 0,
      converted: 0,
      rejected: 0,
    };
    
    overviewStats.statusCounts.forEach((status: { _id: string, count: number }) => {
      if (status._id && statusBreakdown[status._id] !== undefined) {
        statusBreakdown[status._id] = status.count;
      }
    });

    const topReasons = overviewStats.legacyReasons.map((r: { _id: string, count: number }) => ({
      reason: r._id,
      count: r.count
    }));

    // Get recent search jobs
    const recentJobs = await SearchJob.find()
      .sort({ created_at: -1 })
      .limit(5)
      .lean();

    // Get recent legacy leads
    const recentLeads = await Company.find({ is_legacy: true })
      .select('domain name pagespeed_score legacy_reasons created_at')
      .sort({ created_at: -1 })
      .limit(5)
      .lean();

    return NextResponse.json({
      overview: {
        totalCompanies,
        legacyCompanies,
        analyzedCompanies,
        verifiedCompanies,
        sentCompanies,
        avgPageSpeed,
        conversionRate: totalCompanies
          ? Math.round((statusBreakdown.converted / totalCompanies) * 100)
          : 0,
      },
      statusBreakdown,
      recentJobs,
      recentLeads,
      topLegacyReasons: topReasons,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
