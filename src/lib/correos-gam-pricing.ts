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

const CANTON_ALIASES_BY_PROVINCE: Record<string, Record<string, string>> = {
  'san jose': {
    coronado: 'vazquez de coronado',
    'vasquez de coronado': 'vazquez de coronado',
    'leon cortes': 'leon cortes castro',
  },
  alajuela: {
    'alfaro ruiz': 'zarcero',
    'valverde vega': 'sarchi',
  },
};

const OUTSIDE_GAM_CANTONS_BY_PROVINCE: Record<string, Set<string>> = {
  'san jose': new Set(['perez zeledon']),
  alajuela: new Set([
    'san mateo',
    'zarcero',
    'atenas',
    'orotina',
    'san carlos',
    'upala',
    'los chiles',
    'guatuso',
    'rio cuarto',
  ]),
  heredia: new Set(['sarapiqui']),
};

const OUTSIDE_GAM_DISTRICTS_SOURCE: Record<string, Record<string, string[]>> = {
  'san jose': {
    desamparados: ['frailes', 'san cristobal', 'rosario'],
    puriscal: [
      'mercedes sur',
      'barbacoas',
      'grifo alto',
      'san rafael',
      'candelaria',
      'candelarita',
      'desamparaditos',
      'san antonio',
      'chires',
    ],
    tarrazu: ['san lorenzo', 'san carlos'],
    aserri: ['tarbaca', 'vuelta de jorco', 'vuelta del jorco', 'san gabriel', 'legua', 'monterrey'],
    mora: ['guayabo', 'tabarcia', 'piedras negras', 'picagres', 'jagres', 'jaris', 'quitirrisi'],
    'vazquez de coronado': ['dulce nombre', 'dulce nombre de jesus', 'cascajal', 'cascalj'],
    acosta: ['guatil', 'guaitil', 'palmichal', 'cangrejal', 'sabanillas'],
    turrubares: ['san pedro', 'san juan de mata', 'san luis', 'carara'],
    dota: ['jardin', 'copey'],
    'leon cortes castro': ['san andres', 'llano bonito', 'san isidro', 'santa cruz', 'san antonio'],
  },
  alajuela: {
    alajuela: ['sarapiqui'],
    'san ramon': [
      'santiago',
      'san juan',
      'piedades norte',
      'piedades sur',
      'san rafael',
      'san isidro',
      'angeles',
      'alfaro',
      'volio',
      'concepcion',
      'zapotal',
      'penas blancas',
    ],
    grecia: ['san isidro', 'san jose', 'san roque', 'tacares', 'puente de piedra', 'bolivar'],
    palmares: ['zaragoza', 'buenos aires', 'santiago', 'candelaria', 'esquipulas', 'granja', 'la granja'],
    poas: ['san juan', 'san rafael', 'carrillos', 'sabana redonda'],
    sarchi: ['sarchi sur', 'toro amarillo', 'san pedro', 'rodriguez'],
    naranjo: ['san miguel', 'san jose', 'cirri sur', 'san jeronimo', 'san juan', 'rosario', 'el rosario', 'palmitos'],
  },
  cartago: {
    paraiso: ['orosi'],
    jimenez: ['tucurrique', 'pejibaye'],
    turrialba: [
      'la suiza',
      'peralta',
      'santa cruz',
      'santa teresita',
      'pavones',
      'tuis',
      'tayutic',
      'santa rosa',
      'tres equis',
      'la isabel',
      'chirripo',
    ],
    'el guarco': ['patio de agua'],
  },
  heredia: {
    heredia: ['vara blanca', 'varablanca'],
  },
};

const OUTSIDE_GAM_DISTRICTS_BY_PROVINCE = Object.fromEntries(
  Object.entries(OUTSIDE_GAM_DISTRICTS_SOURCE).map(([province, cantons]) => [
    province,
    Object.fromEntries(
      Object.entries(cantons).map(([canton, districts]) => [canton, new Set(districts)])
    ),
  ])
) as Record<string, Record<string, Set<string>>>;

const CANTONS_REQUIRING_DISTRICT = new Set(
  Object.entries(OUTSIDE_GAM_DISTRICTS_BY_PROVINCE).flatMap(([province, cantons]) =>
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
  return OUTSIDE_GAM_DISTRICTS_BY_PROVINCE[input.province]?.[input.canton]?.has(input.district)
    ? 'outside_gam'
    : null;
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
    if (districtOverride === 'outside_gam') {
      return {
        cost: CORREOS_OUTSIDE_GAM_SHIPPING_COST,
        zone: districtOverride,
        reason: 'Distrito fuera de GAM',
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

  if (province && OUTSIDE_GAM_CANTONS_BY_PROVINCE[province]?.has(canton)) {
    return {
      cost: CORREOS_OUTSIDE_GAM_SHIPPING_COST,
      zone: 'outside_gam',
      reason: 'Canton fuera de GAM',
    };
  }

  if (province && CENTRAL_PROVINCES.has(province)) {
    return {
      cost: CORREOS_GAM_SHIPPING_COST,
      zone: 'gam',
      reason: 'Distrito dentro de GAM',
    };
  }

  return {
    cost: null,
    zone: null,
    reason: 'Falta provincia para calcular GAM',
  };
}
