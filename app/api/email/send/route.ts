import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Company } from '@/lib/models';
import { EmailManager } from '@/lib/services/email-manager';
import { canSendOutreachToContact } from '@/lib/utils';

/**
 * POST /api/email/send
 * Body: { companyId, contactId, draftIndex }
 */
export async function POST(request: NextRequest) {
  await dbConnect();

  try {
    const { companyId, contactId, draftIndex } = await request.json();

    if (!companyId || !contactId || draftIndex === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const company = await Company.findById(companyId);
    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    const contact = company.contacts.find((c: any) => c.id === contactId);
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const draft = contact.drafts[draftIndex];
    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    if (!canSendOutreachToContact(contact)) {
      return NextResponse.json(
        { error: 'Contact must have a verified email before sending outreach' },
        { status: 400 }
      );
    }

    // 1. Send the email
    await EmailManager.sendEmail(contact.email, draft);

    // 2. Update the draft sent_at and company status
    draft.sent_at = new Date();
    contact.deliveryStatus = 'sent';
    
    // If we've never contacted them before, move status to contacted
    if (['new', 'needs_drafts', 'drafts_ready'].includes(company.status)) {
      company.status = 'contacted';
    }

    await company.save();

    return NextResponse.json({ success: true, sent_at: draft.sent_at });
  } catch (error) {
    console.error('Email send API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send email' },
      { status: 500 }
    );
  }
}
