import { NextRequest, NextResponse } from 'next/server';
import { 
  processStage1Scraping, 
  processStage2Analysis, 
  processStage3Contacts, 
  processStage4Drafts 
} from '@/lib/workers/queue-processor';

// POST /api/admin/force-pipeline
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { stage } = body;

    let result;

    switch (stage) {
      case 1:
        result = await processStage1Scraping();
        break;
      case 2:
        result = await processStage2Analysis();
        break;
      case 3:
        result = await processStage3Contacts();
        break;
      case 4:
        result = await processStage4Drafts();
        break;
      case 'all':
        // Run them sequentially for a full end-to-end test
        const r1 = await processStage1Scraping();
        const r2 = await processStage2Analysis();
        const r3 = await processStage3Contacts();
        const r4 = await processStage4Drafts();
        
        result = {
          stage1: r1,
          stage2: r2,
          stage3: r3,
          stage4: r4,
        };
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid stage. Use 1, 2, 3, 4, or "all".' },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error forcing pipeline' },
      { status: 500 }
    );
  }
}
