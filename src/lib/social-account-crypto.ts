/**
 * At-rest encryption for SocialAccount.accessToken.
 * Uses the shared AES-GCM helper (`enc:` prefix). Legacy plaintext
 * values pass through decrypt unchanged until the next write encrypts them.
 */
import { decrypt, encrypt } from '@/lib/encryption'

export function encryptSocialAccessToken(
  token: string | null | undefined,
): string | null | undefined {
  if (token == null) return token
  if (!token) return token
  if (token.startsWith('enc:')) return token
  return encrypt(token)
}

export function decryptSocialAccessToken(
  token: string | null | undefined,
): string | null | undefined {
  if (token == null) return token
  if (!token) return token
  return decrypt(token)
}
