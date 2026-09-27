export interface SocialAccount {
  id: string
  platform: string
  accountId: string
  linkedAt: string
  isActive: boolean
  phoneNumberId?: string | null
  whatsappBusinessAccountId?: string | null
  pageId?: string | null
  displayName?: string | null
  providerDisplayName?: string | null
  providerUsername?: string | null
  displayPhoneNumber?: string | null
  logoKey?: 'whatsapp' | 'instagram'
  tokenStatus?: string | null
  wabaId?: string | null
  disconnectedAt?: string | null
  lastWebhookAt?: string | null
}
