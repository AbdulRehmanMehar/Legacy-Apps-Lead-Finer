import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Company } from '@/lib/models';

// GET /api/companies - List all companies with filters
export async function GET(request: NextRequest) {
  await dbConnect();
  const searchParams = request.nextUrl.searchParams;

  // Parse query params
  const status = searchParams.get('status');
  const isLegacy = searchParams.get('is_legacy');
  const search = searchParams.get('search');
  const verifiedOnly = searchParams.get('verified_only');
  const sentOnly = searchParams.get('sent_only');
  const sortBy = searchParams.get('sort_by') || 'created_at';
  const sortOrder = searchParams.get('sort_order') || 'desc';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const offset = (page - 1) * limit;

  try {
    const query: any = {};
    const andConditions: any[] = [];

    // Apply filters with grouping support
    if (status && status !== 'all') {
      if (status === 'discovery') {
        query.status = { $in: ['analyzing', 'needs_contacts', 'fetching_contacts', 'needs_verified_contacts'] };
      } else if (status === 'ready') {
        query.status = { $in: ['needs_drafts', 'drafting', 'drafts_ready'] };
      } else if (status === 'active') {
        query.status = { $in: ['contacted', 'qualified', 'converted'] };
      } else if (status === 'rejected') {
        query.status = { $in: ['rejected', 'unreachable'] };
      } else if (status === 'needs_verified_contacts') {
        query.status = 'needs_verified_contacts';
      } else {
        query.status = status;
      }
    }

    if (isLegacy !== null && isLegacy !== '' && isLegacy !== 'all') {
      query.is_legacy = isLegacy === 'true';
    }

    if (search) {
      andConditions.push({
        $or: [
        { domain: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        ],
      });
    }

    if (verifiedOnly === 'true') {
      andConditions.push({
        contacts: {
          $elemMatch: {
            email: { $exists: true, $ne: null },
            verificationStatus: 'verified',
            emailProviderVerified: true,
            deliveryStatus: { $ne: 'bounced' },
          },
        },
      });
    }

    if (sentOnly === 'true') {
      andConditions.push({
        contacts: {
          $elemMatch: {
            drafts: {
              $elemMatch: {
                sent_at: { $exists: true, $ne: null },
              },
            },
          },
        },
      });
    }

    if (andConditions.length > 0) {
      query.$and = andConditions;
    }

    // Apply sorting
    const sortParams: any = {};
    sortParams[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute queries in parallel
    const [data, count] = await Promise.all([
      Company.find(query).sort(sortParams).skip(offset).limit(limit),
      Company.countDocuments(query),
    ]);

    return NextResponse.json({
      companies: data,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch companies' },
      { status: 500 }
    );
  }
}

// POST /api/companies - Add a new company
export async function POST(request: NextRequest) {
  await dbConnect();

  try {
    const body = await request.json();
    const { domain, name, description, search_query } = body;

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 });
    }

    // Clean the domain
    const cleanDomain = domain
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];

    // Check if already exists
    const existing = await Company.findOne({ domain: cleanDomain }).select('id');

    if (existing) {
      return NextResponse.json(
        { error: 'Company with this domain already exists', id: existing.id },
        { status: 409 }
      );
    }

    // Insert new company
    const company = await Company.create({
      domain: cleanDomain,
      name: name || undefined,
      description: description || undefined,
      search_query: search_query || undefined,
    });

    return NextResponse.json({ company }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create company' },
      { status: 500 }
    );
  }
}
