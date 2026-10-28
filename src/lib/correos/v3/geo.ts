import type { CorreosV3Client } from './client';
import type { V3Barrio, V3Distrito, V3Provincia, V3Sucursal } from './types';

/**
 * Correos v3 geography + branches with a 24 h in-memory cache shared by every
 * client of the same base URL (the lists rarely change), plus name → code
 * matching for orders that store names ("San José", "Escazú").
 */

const TTL_MS = 24 * 3_600_000;
const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export function __resetV3GeoCache() {
  cache.clear();
  inflight.clear();
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = load()
    .then((value) => {
      if (cache.size > 5000) cache.clear();
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function foldName(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact → starts-with → contains, on folded names. */
export function matchByName<T extends { nombre: string }>(items: T[], name: string | null | undefined): T | null {
  const needle = foldName(name);
  if (!needle) return null;
  const folded = items.map((i) => [foldName(i.nombre), i] as const);
  return (
    folded.find(([n]) => n === needle)?.[1] ??
    folded.find(([n]) => n.startsWith(needle) || needle.startsWith(n))?.[1] ??
    folded.find(([n]) => n.includes(needle) || needle.includes(n))?.[1] ??
    null
  );
}

export interface ResolvedPlace {
  provincia: V3Provincia;
  canton: V3Provincia;
  distrito: V3Distrito;
  codigoPostal: string | null;
  poseeSucursal: boolean;
}

export class CorreosV3Geo {
  constructor(private readonly client: CorreosV3Client) {}

  private key(...parts: string[]) {
    return `${this.client.baseUrl}|${parts.join('|')}`;
  }

  provincias() {
    return cached(this.key('prov'), () => this.client.provincias());
  }

  cantones(provincia: string) {
    return cached(this.key('cant', provincia), () => this.client.cantones(provincia));
  }

  distritos(provincia: string, canton: string) {
    return cached(this.key('dist', provincia, canton), () => this.client.distritos(provincia, canton));
  }

  barrios(provincia: string, canton: string, distrito: string): Promise<V3Barrio[]> {
    return cached(this.key('barr', provincia, canton, distrito), () => this.client.barrios(provincia, canton, distrito));
  }

  sucursales(provincia: string, canton: string): Promise<V3Sucursal[]> {
    return cached(this.key('suc', provincia, canton), () => this.client.sucursales(provincia, canton));
  }

  /** Names (or codes) → codes + postal code. Returns null when any level does not match. */
  async resolve(province: string, canton: string, district: string): Promise<ResolvedPlace | null> {
    const provs = await this.provincias();
    const p = provs.find((x) => x.codigo === province) ?? matchByName(provs, province);
    if (!p) return null;
    const cants = await this.cantones(p.codigo);
    const c = cants.find((x) => x.codigo === canton) ?? matchByName(cants, canton);
    if (!c) return null;
    const dists = await this.distritos(p.codigo, c.codigo);
    const d = dists.find((x) => x.codigo === district) ?? matchByName(dists, district);
    if (!d) return null;
    return {
      provincia: p,
      canton: c,
      distrito: d,
      codigoPostal: d.codigoPostal || null,
      poseeSucursal: String(d.poseeSucursal ?? '').toUpperCase() === 'S',
    };
  }

  /** True when the named barrio is marked restricted by Correos (unknown → false). */
  async isRestricted(place: ResolvedPlace, barrio: string | null | undefined): Promise<{ restricted: boolean; anyRestricted: boolean }> {
    const list = await this.barrios(place.provincia.codigo, place.canton.codigo, place.distrito.codigo);
    const anyRestricted = list.some((b) => String(b.zonaRestringida ?? '').toUpperCase() === 'S');
    const hit = barrio ? matchByName(list, barrio) : null;
    return { restricted: String(hit?.zonaRestringida ?? '').toUpperCase() === 'S', anyRestricted };
  }
}
