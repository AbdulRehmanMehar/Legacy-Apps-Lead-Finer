import { verifyEmail } from '../lib/services/email-verifier';

async function testVerification() {
  const emails = [
    'support@github.com',     // Valid
    'nonexistent@github.com', // Should be invalid
    'invalid-domain-123.com', // Invalid domain
    'test@gmail.com',         // Valid (though Gmail can be tricky)
  ];

  console.log('🧪 Starting Email Verification Tests...');
  console.log('──────────────────────────────────────');

  for (const email of emails) {
    console.log(`🔍 Testing: ${email}`);
    try {
      const result = await verifyEmail(email);
      console.log(`   Result: ${result.isValid ? '✅ VALID' : '❌ INVALID'}`);
      console.log(`   Status: ${result.status}`);
      if (result.error) console.log(`   Error: ${result.error}`);
    } catch (err) {
      console.error(`   💥 Fatal Error:`, err);
    }
    console.log('──────────────────────────────────────');
  }
}

testVerification().catch(console.error);
