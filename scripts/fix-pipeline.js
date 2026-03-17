const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  // FIX 1: Reset wrongly-rejected legacy companies back to needs_contacts
  const fix1 = await db.collection('companies').updateMany(
    { status: 'rejected', is_legacy: true },
    { $set: { status: 'needs_contacts', contact_retry_count: 0 } }
  );
  console.log('Fix 1 - Wrongly rejected legacy reset to needs_contacts:', fix1.modifiedCount);

  // FIX 2: Reset falsely-unreachable companies (have pagespeed_score = were actually reachable)
  const falseUnreachable = await db.collection('companies').find(
    { status: 'unreachable', pagespeed_score: { $gt: 0 } }
  ).toArray();
  console.log('Fix 2 - Falsely unreachable (have pagespeed score):', falseUnreachable.length);

  if (falseUnreachable.length > 0) {
    const domainList = falseUnreachable.map(c => c.domain);

    // Reset company status back to new so Stage 2 can re-analyze
    await db.collection('companies').updateMany(
      { domain: { $in: domainList } },
      { $set: { status: 'new', tech_stack: [], is_legacy: false, legacy_reasons: [] } }
    );

    // Re-add to analysis queue (skip domains already queued as pending)
    const existingQueued = new Set(
      (await db.collection('analysisqueueitems')
        .find({ domain: { $in: domainList }, status: 'pending' })
        .toArray()).map(q => q.domain)
    );
    const toRequeue = falseUnreachable.filter(c => !existingQueued.has(c.domain));
    if (toRequeue.length > 0) {
      await db.collection('analysisqueueitems').insertMany(
        toRequeue.map(c => ({
          company_id: String(c._id),
          domain: c.domain,
          status: 'pending',
          retry_count: 0,
          created_at: new Date(),
        }))
      );
    }
    console.log('  Companies reset to new:', domainList.length);
    console.log('  Re-queued for Stage 2 :', toRequeue.length);
  }

  // Final breakdown
  console.log('\nUpdated status breakdown:');
  const statuses = await db.collection('companies').aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  statuses.forEach(s => console.log('  ' + String(s._id).padEnd(22) + ' ' + s.count));

  console.log('\nPending queue items:', await db.collection('analysisqueueitems').countDocuments({ status: 'pending' }));

  await mongoose.disconnect();
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
