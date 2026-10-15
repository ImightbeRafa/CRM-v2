/**
 * Cron de-duplication for the Cloudflare Worker (src/cf-container-worker.ts). Pure: no Worker APIs.
 *
 * 2026-10-13 from 06:40 UTC Cloudflare fired every cron twice per slot (two schedulers: ~:04 and
 * ~:43 into the same minute, different `scheduledTime`). The late copy of the 14:00 hot backup hit
 * the backup lock and emailed "Respaldo parcial FALLÓ" while the first copy was succeeding.
 * One run per cron per minute: the first invocation claims the minute, later ones skip.
 */

/** Storage key: one per cron expression (8 keys total, overwritten, never grows). */
export function cronSlotStorageKey(cron: string): string {
  return `betsy-cron-slot:${cron}`;
}

/** The minute this invocation belongs to (scheduledTime is ms since epoch). */
export function cronSlotMinute(scheduledTimeMs: number): number {
  return Math.floor(scheduledTimeMs / 60_000);
}

/** True when this invocation should run: no earlier invocation claimed this minute (or a later one). */
export function shouldRunCronSlot(lastClaimedMinute: number | undefined, minute: number): boolean {
  return typeof lastClaimedMinute !== "number" || !Number.isFinite(lastClaimedMinute) || minute > lastClaimedMinute;
}
