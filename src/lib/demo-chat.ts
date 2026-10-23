/**
 * Demo chats for the Meta App Review screencast (scripts/meta-review-demo-seed.ts): the customer id is made up and
 * starts with "demo-", so nothing may ever be sent to Meta for it (client-safe, no I/O).
 */
export const DEMO_PEER_PREFIX = 'demo-'

export function isDemoPeerId(peerId: unknown): boolean {
  return typeof peerId === 'string' && peerId.startsWith(DEMO_PEER_PREFIX)
}
