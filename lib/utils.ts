import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ContactPerson } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Free consumer email domains — RocketReach occasionally returns personal
// addresses for business contacts. These are never valid B2B outreach targets.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com',
  'proton.me', 'tutanota.com', 'zohomail.com', 'yandex.com', 'yandex.ru',
]);

export function isPersonalEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? FREE_EMAIL_DOMAINS.has(domain) : false;
}

export function canSendOutreachToContact(
  contact: Pick<ContactPerson, 'email' | 'verificationStatus' | 'deliveryStatus'> | null | undefined
) {
  if (!contact?.email) return false;
  if (contact.deliveryStatus === 'bounced') return false;
  // Guessed addresses were never verified — too noisy, skip them.
  if (contact.verificationStatus === 'guessed') return false;
  // 'invalid' means the domain has no MX records — genuinely undeliverable.
  if (contact.verificationStatus === 'invalid') return false;
  // Personal email domains (gmail, yahoo, etc.) are not valid B2B targets.
  // RocketReach occasionally returns these by mistake.
  if (isPersonalEmailDomain(contact.email)) return false;
  return true;
}

export function hasVerifiedOutreachContact(
  contacts: Array<Pick<ContactPerson, 'email' | 'verificationStatus' | 'deliveryStatus'>> | null | undefined
) {
  return (contacts ?? []).some((contact) => canSendOutreachToContact(contact))
}

export function hasSentDraft(
  contacts:
    | Array<Pick<ContactPerson, 'drafts'> & { drafts?: Array<{ sent_at?: Date | string | null }> }>
    | null
    | undefined
) {
  return (contacts ?? []).some((contact) =>
    (contact.drafts ?? []).some((draft) => Boolean(draft.sent_at))
  )
}

export function getContactOutreachLabel(
  contact: Pick<ContactPerson, 'email' | 'verificationStatus' | 'deliveryStatus'> | null | undefined
) {
  if (!contact?.email) return 'No email'
  if (contact.deliveryStatus === 'bounced') return 'Bounced'
  if (contact.verificationStatus === 'verified') return 'Verified'
  if (contact.verificationStatus === 'catch_all') return 'Catch-all (sendable)'
  if (contact.verificationStatus === 'unknown') return 'Unconfirmed (sendable)'
  if (contact.verificationStatus === 'invalid') return 'Invalid - no MX'
  return 'Pending verification'
}
