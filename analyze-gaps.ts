import dbConnect from './lib/mongodb';
import { Company } from './lib/models';

async function analyzeContactGaps() {
  await dbConnect();
  
  const total = await Company.countDocuments();
  const withContacts = await Company.countDocuments({ contacts: { $exists: true, $not: { $size: 0 } } });
  
  // Find legacy companies with NO contacts
  const legacyNoContacts = await Company.countDocuments({ 
    is_legacy: true, 
    contacts: { $size: 0 } 
  });
  
  const statusBreakdown = await Company.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } }
  ]);

  console.log(`Total Companies: ${total}`);
  console.log(`With Contacts: ${withContacts}`);
  console.log(`Legacy Companies with 0 Contacts: ${legacyNoContacts}`);
  console.log('\nStatus Breakdown:');
  statusBreakdown.forEach(s => console.log(`- ${s._id}: ${s.count}`));
  
  // Sample rejected domains that are legacy
  const samples = await Company.find({ is_legacy: true, status: 'rejected', contacts: { $size: 0 } }).limit(10);
  if (samples.length > 0) {
    console.log('\nSample Legacy Leads with 0 Contacts (Status: rejected):');
    samples.forEach(s => console.log(`- ${s.domain}`));
  }

  process.exit(0);
}

analyzeContactGaps();
