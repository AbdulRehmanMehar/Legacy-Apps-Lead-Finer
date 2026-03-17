import dbConnect from '../lib/mongodb';
import { Company } from '../lib/models';
import mongoose from 'mongoose';

async function check() {
  await dbConnect();
  const companies = await Company.find().sort({ created_at: -1 }).limit(10);
  for (const c of companies) {
    console.log(`Domain: ${c.domain}`);
    console.log(`Tech Stack length: ${c.tech_stack?.length}`);
    console.log(`Tech Stack:`, JSON.stringify(c.tech_stack, null, 2));
    console.log(`Status: ${c.status}`);
    console.log(`Legacy: ${c.is_legacy}, Reasons: ${c.legacy_reasons?.join(', ')}`);
    console.log(`Errors:`, c.last_error || 'None directly logged, might be in DB missing');
    console.log('---');
  }
  
  // also get the queue items to see errors
  const queueItems = await mongoose.model('AnalysisQueueItem').find().sort({ created_at: -1 }).limit(10);
  console.log('Recent Queue Items:');
  for (const q of queueItems) {
    console.log(`Domain: ${q.domain}, Status: ${q.status}, Error: ${(q as any).error}`);
  }
  
  await mongoose.disconnect();
}
check().catch(console.error);
