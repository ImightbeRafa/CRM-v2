export const CORREOS_GAM_SHIPPING_COST = 2100;
export const CORREOS_OUTSIDE_GAM_SHIPPING_COST = 2850;

type CorreosShippingZone = 'gam' | 'outside_gam';

type CorreosShippingCostResult = {
  cost: number | null;
  zone: CorreosShippingZone | null;
  reason: string;
};

const CENTRAL_PROVINCES = new Set(['san jose', 'alajuela', 'cartago', 'heredia']);
const OUTSIDE_GAM_PROVINCES = new Set(['guanacaste', 'puntarenas', 'limon']);

// Plan GAM 2013-2030 scope, applied at canton level for operations pricing.
const GAM_CANTONS_BY_PROVINCE: Record<string, Set<string>> = {
  'san jose': new Set([
    'san jose',
    'escazu',
    'desamparados',
    'aserri',
    'mora',
    'goicoechea',
    'santa ana',
    'alajuelita',
    'vazquez de coronado',
    'tibas',
    'moravia',
    'montes de oca',
    'curridabat',
  ]),
  alajuela: new Set(['alajuela', 'atenas', 'poas']),
  cartago: new Set(['cartago', 'paraiso', 'la union', 'alvarado', 'oreamuno', 'el guarco']),
  heredia: new Set([
    'heredia',
    'barva',
    'santo domingo',
    'santa barbara',
    'san rafael',
    'san isidro',
    'belen',
    'flores',
    'san pablo',
  ]),
};

const GAM_CANTONS = new Set(Object.values(GAM_CANTONS_BY_PROVINCE).flatMap((cantons) => [...cantons]));

const CANTON_ALIASES_BY_PROVINCE: Record<string, Record<string, string>> = {
  'san jose': {
    coronado: 'vazquez de coronado',
    'vasquez de coronado': 'vazquez de coronado',
  },
};

const DISTRICT_ZONE_OVERRIDES_BY_PROVINCE: Record<
  string,
  Record<string, Record<string, CorreosShippingZone>>
> = {
  'san jose': {
    puriscal: {
      santiago: 'gam',
    },
    acosta: {
      'san ignacio': 'gam',
    },
    'vazquez de coronado': {
      'san rafael': 'gam',
      cascajal: 'outside_gam',
      'dulce nombre': 'outside_gam',
      'dulce nombre de jesus': 'outside_gam',
    },
  },
};

const CANTONS_REQUIRING_DISTRICT = new Set(
  Object.entries(DISTRICT_ZONE_OVERRIDES_BY_PROVINCE).flatMap(([province, cantons]) =>
    Object.keys(cantons).map((canton) => `${province}:${canton}`)
  )
);

export function normalizeCostaRicaLocation(value: string | null | undefined): string {
  return (value ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeCanton(province: string, canton: string): string {
  return CANTON_ALIASES_BY_PROVINCE[province]?.[canton] ?? canton;
}

function getDistrictZoneOverride(input: {
  province: string;
  canton: string;
  district: string;
}): CorreosShippingZone | null {
  return DISTRICT_ZONE_OVERRIDES_BY_PROVINCE[input.province]?.[input.canton]?.[input.district] ?? null;
}

export function getCorreosAutomatedShippingCost(input: {
  province?: string | null;
  canton?: string | null;
  district?: string | null;
}): CorreosShippingCostResult {
  const province = normalizeCostaRicaLocation(input.province);
  const rawCanton = normalizeCostaRicaLocation(input.canton);
  const canton = canonicalizeCanton(province, rawCanton);
  const district = normalizeCostaRicaLocation(input.district);

  if (province && OUTSIDE_GAM_PROVINCES.has(province)) {
    return {
      cost: CORREOS_OUTSIDE_GAM_SHIPPING_COST,
      zone: 'outside_gam',
      reason: 'Provincia fuera de GAM',
    };
  }

  if (!canton) {
    return {
      cost: null,
      zone: null,
      reason: province && CENTRAL_PROVINCES.has(province)
        ? 'Falta canton para calcular GAM'
        : 'Falta canton o provincia para calcular GAM',
    };
  }

  if (province) {
    const districtOverride = district
      ? getDistrictZoneOverride({ province, canton, district })
      : null;
    if (districtOverride) {
      return {
        cost: districtOverride === 'gam' ? CORREOS_GAM_SHIPPING_COST : CORREOS_OUTSIDE_GAM_SHIPPING_COST,
        zone: districtOverride,
        reason: districtOverride === 'gam' ? 'Distrito dentro de GAM' : 'Distrito fuera de GAM',
      };
    }

    if (!district && CANTONS_REQUIRING_DISTRICT.has(`${province}:${canton}`)) {
      return {
        cost: null,
        zone: null,
        reason: 'Falta distrito para calcular GAM en canton con excepciones',
      };
    }
  }

  if (province && CENTRAL_PROVINCES.has(province)) {
    const provinceGamCantons = GAM_CANTONS_BY_PROVINCE[province];
    const isGam = provinceGamCantons?.has(canton) ?? false;
    return {
      cost: isGam ? CORREOS_GAM_SHIPPING_COST : CORREOS_OUTSIDE_GAM_SHIPPING_COST,
      zone: isGam ? 'gam' : 'outside_gam',
      reason: isGam ? 'Canton dentro de GAM' : 'Canton fuera de GAM',
    };
  }

  if (!province && GAM_CANTONS.has(canton)) {
    return {
      cost: CORREOS_GAM_SHIPPING_COST,
      zone: 'gam',
      reason: 'Canton dentro de GAM',
    };
  }

  return {
    cost: CORREOS_OUTSIDE_GAM_SHIPPING_COST,
    zone: 'outside_gam',
    reason: province ? 'Provincia fuera de GAM' : 'Canton fuera de GAM',
  };
}
