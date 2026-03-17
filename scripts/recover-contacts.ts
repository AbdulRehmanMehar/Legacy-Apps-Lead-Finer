import dbConnect from '../lib/mongodb';
import { Company } from '../lib/models';

async function recoverContacts() {
  await dbConnect();
  
  console.log('🔄 Starting Contact Recovery for existing legacy leads...');
  
  // Find legacy companies that have 0 contacts OR contacts with no emails
  const result = await Company.updateMany(
    { 
      is_legacy: true, 
      $or: [
        { contacts: { $size: 0 } },
        { "contacts.0.email": { $exists: false } },
        { "contacts.0.email": null }
      ],
      status: { $in: ['rejected', 'needs_contacts', 'needs_verified_contacts', 'new', 'unreachable', 'needs_drafts', 'drafts_ready'] } 
    },
    { 
      $set: { 
        status: 'needs_contacts',
        contact_retry_count: 0,
        last_error: 'Reset for resilient search recovery'
      } 
    }
  );

  console.log(`✅ Recovery complete!`);
  console.log(`📊 Total leads re-queued for contact fetching: ${result.modifiedCount}`);
  console.log(`ℹ️ These leads will now be picked up by the background worker using the new resilient search logic.`);

  process.exit(0);
}

recoverContacts().catch(err => {
  console.error('❌ Recovery failed:', err);
  process.exit(1);
});
