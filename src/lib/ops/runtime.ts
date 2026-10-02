/**
 * True only inside the production container started by the Cloudflare Worker (the Worker sets
 * BACKUP_WRITER=1 in its own code). The Railway preview shares the production database: anything
 * that writes platform-level rows (error groups, Meta dataset status, backups) checks this first.
 */
export function isProductionContainer(env: Record<string, string | undefined> = process.env): boolean {
  return (env.BACKUP_WRITER || '').trim() === '1'
}
