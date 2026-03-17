import { generateInitialEmail, generateFollowupEmail } from '../lib/services/ollama';

async function testGeneration() {
  console.log("Testing new Email Generation framework...\\n");
  
  const contact = {
    firstName: "Abdul",
    lastName: "Rehman",
    title: "CTO",
    company: "Acme Corp"
  };

  const analysis = {
    domain: "acme.com",
    techStack: ["jQuery", "PHP 5.6", "Apache"],
    legacyReasons: ["Uses outdated PHP version", "No modern JS framework"],
    pagespeedScore: 32
  };

  console.log("--- Initial Email ---");
  const initial = await generateInitialEmail(contact, analysis, "Focus on their speed and outdated PHP");
  console.log(`Subject: ${initial.subject}`);
  console.log(`Body:\\n${initial.body}\\n`);

  console.log("--- Follow up Email ---");
  const followup = await generateFollowupEmail(contact, {
    subject: initial.subject,
    body: initial.body,
    sentAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  }, 1);
  console.log(`Subject: ${followup.subject}`);
  console.log(`Body:\\n${followup.body}\\n`);
}

testGeneration().catch(console.error);
