import crypto from 'crypto'

/**
 * Generate appsecret_proof for Meta API calls
 * This is required when app secret proof is enabled in Meta app settings
 */
export function generateAppSecretProof(accessToken: string): string {
  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) {
    console.warn('[meta-api] META_APP_SECRET not configured, skipping appsecret_proof')
    return ''
  }
  
  if (!accessToken) {
    console.warn('[meta-api] No access token provided for appsecret_proof generation')
    return ''
  }
  
  try {
    return crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex')
  } catch (error) {
    console.error('[meta-api] Error generating appsecret_proof:', error)
    return ''
  }
}

/**
 * Add appsecret_proof to a Meta API URL if required
 */
export function addAppSecretProofToUrl(baseUrl: string, accessToken: string): string {
  const proof = generateAppSecretProof(accessToken)
  if (!proof) return baseUrl
  
  const separator = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${separator}appsecret_proof=${proof}`
}

/**
 * Common headers for Meta API requests
 */
export function getMetaApiHeaders(accessToken: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Betsy-CRM/1.0'
  }
}
