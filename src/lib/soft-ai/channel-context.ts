import {
  formatCanalContextLine,
  type SocialAccountIdentityFields,
} from '@/lib/social-account-identity'

/** Soft AI prompt-ready channel line — no behavior change beyond context. */
export function softAiCanalContextLine(account: SocialAccountIdentityFields): string {
  return formatCanalContextLine(account)
}
