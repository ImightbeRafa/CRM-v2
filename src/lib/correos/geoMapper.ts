import type { CorreosSoapClient } from './soapClient';
import type { CcrItemGeografico } from './types';

/**
 * Maps human-readable province/canton/district names to the numeric codes
 * required by the Correos SOAP API, using the API itself as the data source.
 *
 * Results are cached in memory so subsequent lookups are instant.
 */

interface GeoEntry {
  code: string;
  name: string;
}

interface CantonEntry extends GeoEntry {
  provinceCode: string;
}

interface DistritoEntry extends GeoEntry {
  provinceCode: string;
  cantonCode: string;
}

let provincesCache: GeoEntry[] | null = null;
let cantonesCache: Map<string, GeoEntry[]> = new Map();
let distritosCache: Map<string, GeoEntry[]> = new Map();

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

function findBestMatch(items: GeoEntry[], name: string): GeoEntry | null {
  const needle = normalize(name);
  if (!needle) return items[0] ?? null;

  const exact = items.find((i) => normalize(i.name) === needle);
  if (exact) return exact;

  const startsWith = items.find((i) => normalize(i.name).startsWith(needle));
  if (startsWith) return startsWith;

  const needleStartsWith = items.find((i) => needle.startsWith(normalize(i.name)));
  if (needleStartsWith) return needleStartsWith;

  const contains = items.find((i) => normalize(i.name).includes(needle));
  if (contains) return contains;

  const reverseContains = items.find((i) => needle.includes(normalize(i.name)));
  if (reverseContains) return reverseContains;

  // Try matching individual words (e.g., "San Antonio" might be listed as "SAN ANTONIO")
  const needleWords = needle.split(/\s+/);
  if (needleWords.length > 1) {
    const multiWordMatch = items.find((i) => {
      const normalized = normalize(i.name);
      return needleWords.every((w) => normalized.includes(w));
    });
    if (multiWordMatch) return multiWordMatch;
  }

  return null;
}

export class CorreosGeoMapper {
  private client: CorreosSoapClient;

  constructor(client: CorreosSoapClient) {
    this.client = client;
  }

  // ─── Province ─────────────────────────────────────────────────────────────

  async loadProvinces(): Promise<GeoEntry[]> {
    if (provincesCache) return provincesCache;

    const res = await this.client.getProvincias();
    if (res.CodRespuesta !== '00' || !res.Provincias) {
      throw new Error(`Failed to load provinces: ${res.MensajeRespuesta}`);
    }

    provincesCache = res.Provincias.map((p: CcrItemGeografico) => ({
      code: p.Codigo,
      name: p.Descripcion,
    }));
    return provincesCache;
  }

  async getProvinceCode(name: string): Promise<string> {
    const provinces = await this.loadProvinces();
    const match = findBestMatch(provinces, name);
    if (!match) {
      throw new Error(`Province not found: "${name}". Available: ${provinces.map((p) => p.name).join(', ')}`);
    }
    return match.code;
  }

  // ─── Canton ───────────────────────────────────────────────────────────────

  async loadCantones(codProvincia: string): Promise<GeoEntry[]> {
    const cacheKey = codProvincia;
    if (cantonesCache.has(cacheKey)) return cantonesCache.get(cacheKey)!;

    const res = await this.client.getCantones(codProvincia);
    if (res.CodRespuesta !== '00' || !res.Cantones) {
      throw new Error(`Failed to load cantones for province ${codProvincia}: ${res.MensajeRespuesta}`);
    }

    const entries = res.Cantones.map((c: CcrItemGeografico) => ({
      code: c.Codigo,
      name: c.Descripcion,
    }));
    cantonesCache.set(cacheKey, entries);
    return entries;
  }

  async getCantonCode(codProvincia: string, cantonName: string): Promise<string> {
    const cantones = await this.loadCantones(codProvincia);
    const match = findBestMatch(cantones, cantonName);
    if (!match) {
      throw new Error(
        `Canton not found: "${cantonName}" in province ${codProvincia}. Available: ${cantones.map((c) => c.name).join(', ')}`
      );
    }
    return match.code;
  }

  // ─── Distrito ─────────────────────────────────────────────────────────────

  async loadDistritos(codProvincia: string, codCanton: string): Promise<GeoEntry[]> {
    const cacheKey = `${codProvincia}-${codCanton}`;
    if (distritosCache.has(cacheKey)) return distritosCache.get(cacheKey)!;

    const res = await this.client.getDistritos(codProvincia, codCanton);
    if (res.CodRespuesta !== '00' || !res.Distritos) {
      throw new Error(
        `Failed to load distritos for ${codProvincia}/${codCanton}: ${res.MensajeRespuesta}`
      );
    }

    const entries = res.Distritos.map((d: CcrItemGeografico) => ({
      code: d.Codigo,
      name: d.Descripcion,
    }));
    distritosCache.set(cacheKey, entries);
    return entries;
  }

  async getDistritoCode(
    codProvincia: string,
    codCanton: string,
    distritoName: string
  ): Promise<string> {
    const distritos = await this.loadDistritos(codProvincia, codCanton);
    const match = findBestMatch(distritos, distritoName);
    if (!match) {
      console.warn(
        `[GeoMapper] Distrito not found: "${distritoName}" (normalized: "${normalize(distritoName)}") in prov=${codProvincia}/canton=${codCanton}. Available: ${distritos.map((d) => `${d.code}:${d.name}`).join(', ')}`
      );
      throw new Error(
        `Distrito not found: "${distritoName}" in ${codProvincia}/${codCanton}. Available: ${distritos.map((d) => d.name).join(', ')}`
      );
    }
    return match.code;
  }

  // ─── Resolve all three at once ────────────────────────────────────────────

  async resolveLocation(
    provinceName: string,
    cantonName: string,
    distritoName: string
  ): Promise<{ codProvincia: string; codCanton: string; codDistrito: string }> {
    const codProvincia = await this.getProvinceCode(provinceName);
    const codCanton = await this.getCantonCode(codProvincia, cantonName);
    const codDistrito = await this.getDistritoCode(codProvincia, codCanton, distritoName);
    return { codProvincia, codCanton, codDistrito };
  }

  // ─── Postal code shortcut ────────────────────────────────────────────────

  async getPostalCode(
    provinceName: string,
    cantonName: string,
    distritoName: string
  ): Promise<string> {
    const { codProvincia, codCanton, codDistrito } = await this.resolveLocation(
      provinceName,
      cantonName,
      distritoName
    );
    const res = await this.client.getCodigoPostal(codProvincia, codCanton, codDistrito);
    if (res.CodRespuesta !== '00') {
      throw new Error(`Failed to get postal code: ${res.MensajeRespuesta}`);
    }
    return res.CodPostal;
  }

  clearCache(): void {
    provincesCache = null;
    cantonesCache.clear();
    distritosCache.clear();
  }
}
