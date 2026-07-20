/** Hardcoded pickup points for RA handoffs. Shared inventory stays on agent_key='laura'. */
export const RETIRO_PICKUP_LOCATIONS = {
  laura_escazu: 'Laura Escazu',
  marlenn_desamparados: 'Marlenn Desamparados',
} as const;

export type RetiroPickupLocation = keyof typeof RETIRO_PICKUP_LOCATIONS;

export function normalizePickupLocation(value: unknown): RetiroPickupLocation | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  return key in RETIRO_PICKUP_LOCATIONS ? (key as RetiroPickupLocation) : null;
}

export function pickupLocationLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  return RETIRO_PICKUP_LOCATIONS[key as RetiroPickupLocation] ?? null;
}

/** Only Laura Escazu retiros deduct from shared Laura inventory. Marlenn is handoff-only. */
export function usesRetiroInventory(location: RetiroPickupLocation | null | undefined): boolean {
  return location === 'laura_escazu';
}
