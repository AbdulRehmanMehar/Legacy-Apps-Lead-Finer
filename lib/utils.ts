import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ContactPerson } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function canSendOutreachToContact(
  contact: Pick<ContactPerson, 'email' | 'verificationStatus' | 'emailProviderVerified' | 'deliveryStatus'> | null | undefined
) {
  return Boolean(contact?.email)
    && contact?.verificationStatus === 'verified'
    && contact?.emailProviderVerified === true
    && contact?.deliveryStatus !== 'bounced'
}

export function hasVerifiedOutreachContact(
  contacts: Array<Pick<ContactPerson, 'email' | 'verificationStatus'>> | null | undefined
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
  contact: Pick<ContactPerson, 'email' | 'verificationStatus' | 'emailProviderVerified' | 'deliveryStatus'> | null | undefined
) {
  if (!contact?.email) return 'No email'
  if (contact.deliveryStatus === 'bounced') return 'Bounced - blocked'
  if (contact.verificationStatus === 'verified' && contact.emailProviderVerified !== true) {
    return 'SMTP-only - blocked'
  }
  if (contact.verificationStatus === 'verified') return 'Verified'
  if (contact.verificationStatus === 'guessed') return 'Guessed - ineligible'
  if (contact.verificationStatus === 'catch_all') return 'Catch-all - ineligible'
  if (contact.verificationStatus === 'invalid') return 'Invalid'
  return 'Unverified - ineligible'
}
