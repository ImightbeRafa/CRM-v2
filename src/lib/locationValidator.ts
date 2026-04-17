import { costaRicaLocations } from '@/app/ventas/components/costaRicaLocations';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LocationFieldResult {
  input: string;
  match: string | null;
  valid: boolean;
  suggestions?: string[];
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

// ── Text normalisation (shared with UI components) ───────────────────────────

function normalizeText(value: string | undefined | null): string {
  const s = (value ?? '').toString();
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

// ── Fuzzy matching (mirrors geoMapper.ts findBestMatch) ──────────────────────

function findBestMatch<T extends { name: string }>(
  items: T[],
  needle: string,
): T | null {
  const n = normalizeText(needle);
  if (!n) return null;

  const exact = items.find(i => normalizeText(i.name) === n);
  if (exact) return exact;

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
