import { costaRicaLocations } from '@/app/ventas/components/costaRicaLocations';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LocationFieldResult {
  input: string;
  match: string | null;
  valid: boolean;
  suggestions?: string[];
}

function hasLocationText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function locationSnapshot(target: {
  province?: string | null;
  canton?: string | null;
  district?: string | null;
}): string {
  return [target.province, target.canton, target.district]
    .map((value) => String(value || '').trim())
    .join(' / ');
}

function applyValidatedLocation(
  target: { province?: string | null; canton?: string | null; district?: string | null },
  result: LocationValidationResult,
): void {
  if (result.province.match) target.province = result.province.match;
  if (result.canton.match) target.canton = result.canton.match;
  if (result.district.match) target.district = result.district.match;
}

function applyPartialLocationMatches(
  target: { province?: string | null; canton?: string | null; district?: string | null },
  result: LocationValidationResult,
): void {
  if (hasLocationText(target.province) && result.province.match) target.province = result.province.match;
  if (hasLocationText(target.canton) && result.canton.match) target.canton = result.canton.match;
  if (hasLocationText(target.district) && result.district.match) target.district = result.district.match;
}

/**
 * Best-effort normalization for order capture. This is intentionally more
 * tolerant than guia generation: it canonicalizes clear matches, fixes the
 * common canton/district swap, and otherwise preserves the user's text so the
 * order can still be created and reviewed later during guia generation.
 */
export function normalizeLocationForOrderCapture(target: {
  orderType?: string | null;
  province?: string | null;
  canton?: string | null;
  district?: string | null;
}): CaptureLocationNormalizationResult {
  if (target.orderType && target.orderType !== 'EA') {
    return { action: 'none', validForGuia: true, corrections: [] };
  }

  if (!hasLocationText(target.province) && !hasLocationText(target.canton) && !hasLocationText(target.district)) {
    return { action: 'none', validForGuia: false, corrections: [] };
  }

  const before = locationSnapshot(target);
  const hasFullTriplet = hasLocationText(target.province) && hasLocationText(target.canton) && hasLocationText(target.district);

  if (hasFullTriplet) {
    const direct = validateLocation(target.province, target.canton, target.district);
    if (direct.valid) {
      applyValidatedLocation(target, direct);
      const after = locationSnapshot(target);
      return {
        action: before === after ? 'none' : 'canonicalized',
        validForGuia: true,
        corrections: before === after ? [] : [`Ubicacion: "${before}" -> "${after}"`],
      };
    }

    const swapped = validateLocation(target.province, target.district, target.canton);
    if (swapped.valid) {
      applyValidatedLocation(target, swapped);
      const after = locationSnapshot(target);
      return {
        action: 'swapped',
        validForGuia: true,
        corrections: [`Ubicacion: "${before}" -> "${after}"`],
      };
    }
  }

  const partial = validateLocation(target.province, target.canton, target.district);
  applyPartialLocationMatches(target, partial);
  const after = locationSnapshot(target);

  if (partial.valid) {
    return {
      action: before === after ? 'none' : 'canonicalized',
      validForGuia: true,
      corrections: before === after ? [] : [`Ubicacion: "${before}" -> "${after}"`],
    };
  }

  return {
    action: before === after ? 'stored_raw' : 'canonicalized',
    validForGuia: false,
    warning: 'Ubicacion guardada como texto recibido. Revisala al generar la guia de Correos.',
    corrections: before === after ? [] : [`Ubicacion parcial: "${before}" -> "${after}"`],
  };
}

export interface LocationValidationResult {
  valid: boolean;
  province: LocationFieldResult;
  canton: LocationFieldResult;
  district: LocationFieldResult;
  correctedProvince?: string;
  correctedCanton?: string;
  correctedDistrict?: string;
}

export type CaptureLocationAction = 'none' | 'canonicalized' | 'swapped' | 'stored_raw';

export interface CaptureLocationNormalizationResult {
  action: CaptureLocationAction;
  validForGuia: boolean;
  warning?: string;
  corrections: string[];
}

// ── Text normalisation (shared with UI components) ───────────────────────────

function decodeEscapedUnicodeText(value: string): string {
  if (!/\\u[0-9a-fA-F]{4}/.test(value)) return value;
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

function normalizeText(value: string | undefined | null): string {
  const s = decodeEscapedUnicodeText((value ?? '').toString());
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

// ── Fuzzy matching (mirrors geoMapper.ts findBestMatch) ──────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function findBestMatch<T extends { name: string }>(
  items: T[],
  needle: string,
): T | null {
  const n = normalizeText(needle);
  if (!n) return null;

  const exact = items.find(i => normalizeText(i.name) === n);
  if (exact) return exact;

  // Compact (no-space) comparison: handles "Sanjose" → "San José" and
  // "Sanjosecito" → "San Josecito", which are common WhatsApp typos. Both
  // sides have spaces stripped before comparing.
  const nCompact = n.replace(/\s+/g, '');
  if (nCompact) {
    const compactExact = items.find(i => normalizeText(i.name).replace(/\s+/g, '') === nCompact);
    if (compactExact) return compactExact;

    const compactStartsWith = items.find(i => normalizeText(i.name).replace(/\s+/g, '').startsWith(nCompact));
    if (compactStartsWith) return compactStartsWith;

    const compactNeedleStartsWith = items.find(i => nCompact.startsWith(normalizeText(i.name).replace(/\s+/g, '')));
    if (compactNeedleStartsWith) return compactNeedleStartsWith;
  }

  const startsWith = items.find(i => normalizeText(i.name).startsWith(n));
  if (startsWith) return startsWith;

  const needleStartsWith = items.find(i => n.startsWith(normalizeText(i.name)));
  if (needleStartsWith) return needleStartsWith;

  const contains = items.find(i => normalizeText(i.name).includes(n));
  if (contains) return contains;

  const reverseContains = items.find(i => n.includes(normalizeText(i.name)));
  if (reverseContains) return reverseContains;

  const needleWords = n.split(/\s+/);
  if (needleWords.length > 1) {
    const multiWord = items.find(i => {
      const norm = normalizeText(i.name);
      return needleWords.every(w => norm.includes(w));
    });
    if (multiWord) return multiWord;
  }

  // Levenshtein fallback for short typos (e.g., "Cartgo" → "Cartago",
  // "Heredi" → "Heredia"). Distance threshold scales with word length so
  // short names like "Limón" don't match unrelated 5-letter names.
  if (nCompact.length >= 4) {
    const threshold = nCompact.length <= 6 ? 1 : 2;
    let best: { item: T; distance: number } | null = null;
    for (const item of items) {
      const itemCompact = normalizeText(item.name).replace(/\s+/g, '');
      if (!itemCompact) continue;
      const d = levenshtein(nCompact, itemCompact);
      if (d <= threshold && (!best || d < best.distance)) {
        best = { item, distance: d };
      }
    }
    if (best) return best.item;
  }

  return null;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a Costa Rica province / canton / district triple against the
 * canonical `costaRicaLocations` data.
 *
 * - Validates progressively: province first, then canton (scoped to province),
 *   then district (scoped to canton).
 * - Uses fuzzy matching so minor typos or accent differences are auto-corrected.
 * - When a level doesn't match, `suggestions` contains all valid options at that
 *   level so the caller (bot / AI) can present them to the user.
 */
export function validateLocation(
  province?: string | null,
  canton?: string | null,
  district?: string | null,
): LocationValidationResult {
  // ── Province ─────────────────────────────────────────────────────
  const provInput = (province ?? '').trim();
  const provinceItems = costaRicaLocations.map(p => ({ name: p.nombre }));
  const provMatch = provInput ? findBestMatch(provinceItems, provInput) : null;
  const matchedProvince = provMatch
    ? costaRicaLocations.find(p => p.nombre === provMatch.name)!
    : null;

  const provResult: LocationFieldResult = {
    input: provInput,
    match: provMatch?.name ?? null,
    valid: !!provMatch,
  };

  if (!matchedProvince) {
    provResult.suggestions = costaRicaLocations.map(p => p.nombre);
    return {
      valid: false,
      province: provResult,
      canton: { input: (canton ?? '').trim(), match: null, valid: false },
      district: { input: (district ?? '').trim(), match: null, valid: false },
    };
  }

  // ── Canton ───────────────────────────────────────────────────────
  const cantInput = (canton ?? '').trim();
  const cantonItems = matchedProvince.cantones.map(c => ({ name: c.nombre }));
  const cantMatch = cantInput ? findBestMatch(cantonItems, cantInput) : null;
  const matchedCanton = cantMatch
    ? matchedProvince.cantones.find(c => c.nombre === cantMatch.name)!
    : null;

  const cantResult: LocationFieldResult = {
    input: cantInput,
    match: cantMatch?.name ?? null,
    valid: !!cantMatch,
  };

  if (!matchedCanton) {
    cantResult.suggestions = matchedProvince.cantones.map(c => c.nombre);
    return {
      valid: false,
      province: provResult,
      correctedProvince: provMatch!.name !== provInput ? provMatch!.name : undefined,
      canton: cantResult,
      district: { input: (district ?? '').trim(), match: null, valid: false },
    };
  }

  // ── District ─────────────────────────────────────────────────────
  const distItems = matchedCanton.distritos.map(d => ({ name: d }));
  const distInput = (district ?? '').trim();
  const distMatch = distInput ? findBestMatch(distItems, distInput) : null;

  const distResult: LocationFieldResult = {
    input: distInput,
    match: distMatch?.name ?? null,
    valid: !!distMatch,
  };

  if (!distMatch) {
    distResult.suggestions = matchedCanton.distritos;
  }

  const allValid = provResult.valid && cantResult.valid && distResult.valid;

  return {
    valid: allValid,
    province: provResult,
    canton: cantResult,
    district: distResult,
    correctedProvince: provMatch!.name !== provInput ? provMatch!.name : undefined,
    correctedCanton: cantMatch!.name !== cantInput ? cantMatch!.name : undefined,
    correctedDistrict: distMatch && distMatch.name !== distInput ? distMatch.name : undefined,
  };
}

/**
 * Build a user-friendly message from a validation result.
 * Used by both the standalone tool and inline validations.
 */
export function formatValidationMessage(result: LocationValidationResult): string {
  if (result.valid) {
    const corrections: string[] = [];
    if (result.correctedProvince) corrections.push(`Provincia: "${result.province.input}" → "${result.correctedProvince}"`);
    if (result.correctedCanton) corrections.push(`Cantón: "${result.canton.input}" → "${result.correctedCanton}"`);
    if (result.correctedDistrict) corrections.push(`Distrito: "${result.district.input}" → "${result.correctedDistrict}"`);

    if (corrections.length > 0) {
      return `✅ Ubicación verificada. Se aplicaron las siguientes correcciones:\n${corrections.map(c => `  - ${c}`).join('\n')}`;
    }
    return '✅ Ubicación verificada correctamente.';
  }

  const lines: string[] = [];

  if (!result.province.valid) {
    lines.push(`La provincia "${result.province.input || '(vacía)'}" no se encontró.`);
    if (result.province.suggestions) {
      lines.push('Provincias disponibles:');
      result.province.suggestions.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    }
    return lines.join('\n');
  }

  if (!result.canton.valid) {
    const prov = result.correctedProvince || result.province.match;
    lines.push(`El cantón "${result.canton.input || '(vacío)'}" no se encontró en ${prov}.`);
    if (result.canton.suggestions) {
      lines.push(`Cantones disponibles en ${prov}:`);
      result.canton.suggestions.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    }
    return lines.join('\n');
  }

  if (!result.district.valid) {
    const cant = result.correctedCanton || result.canton.match;
    lines.push(`El distrito "${result.district.input || '(vacío)'}" no se encontró en el cantón ${cant}.`);
    if (result.district.suggestions) {
      lines.push(`Distritos disponibles en ${cant}:`);
      result.district.suggestions.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    }
    return lines.join('\n');
  }

  return 'Ubicación inválida.';
}
