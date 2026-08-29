import {
  costaRicaLocations,
  type ProvinceData,
  type CantonData,
} from '@/app/ventas/components/costaRicaLocations';

export interface CustomerPasteCandidate {
  name: string;
  phone: string;
  email: string;
  username: string;
  province: string;
  canton: string;
  district: string;
  address: string;
  [key: string]: unknown;
}

export function normalizeCustomerPasteText(value: string | undefined | null) {
  return (value ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function findProvince(provinceName: string): ProvinceData | undefined {
  const target = normalizeCustomerPasteText(provinceName);
  return costaRicaLocations.find(province => normalizeCustomerPasteText(province.nombre) === target);
}

function findCanton(province: ProvinceData | undefined, cantonName: string): CantonData | undefined {
  if (!province) return undefined;
  const target = normalizeCustomerPasteText(cantonName);
  return province.cantones.find(canton => normalizeCustomerPasteText(canton.nombre) === target);
}

/** Immediate, deterministic parser. It never calls a network service and is
 * always the first layer before an optional AI suggestion. */
export function parseCustomerPaste<T extends CustomerPasteCandidate>(
  text: string,
  current: T,
): T {
  if (!text.trim()) return { ...current };

  const lines = text.split(/[\n\r]+/).map(line => line.trim()).filter(Boolean);
  const normalizedText = text.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ');
  const separators = '[:=|\\-~]';
  const extractField = (keywords: string[], wholeText: string): string => {
    for (const keyword of keywords) {
      const pattern1 = new RegExp(
        `(?:📍|☎️|🏠|✉️|🗺️)?\\s*${keyword}\\s*${separators}?\\s*([^\\n]+?)(?=(?:Nombre|Tel[eé]fono|Tel|Provincia|Cant[oó]n|Distrito|Correo|Email|Direcci[oó]n|$))`,
        'i',
      );
      const match1 = wholeText.match(pattern1);
      if (match1?.[1]?.trim()) return match1[1].trim();
      const pattern2 = new RegExp(`${keyword}\\s*${separators}\\s*(.+?)(?=\\n|$)`, 'i');
      const match2 = wholeText.match(pattern2);
      if (match2?.[1]?.trim()) return match2[1].trim();
    }
    return '';
  };

  const nameRaw = extractField(['Nombre\\s*completo', 'Nombre', 'Name', 'Cliente', 'Comprador'], normalizedText);
  const phoneRaw = extractField(['Tel[eé]fono', 'Tel[eé]f', 'Tel', 'Phone', 'Celular', 'M[oó]vil', 'Contacto'], normalizedText);
  const emailRaw = extractField(['Correo\\s*electr[oó]nico', 'Correo', 'Email', 'e-mail', 'E-mail', 'Mail'], normalizedText);
  const addressRaw = extractField([
    'Direcci[oó]n\\s*exacta\\s*donde\\s*deseas?\\s*recibirlo',
    'Direcci[oó]n\\s*exacta', 'Direcci[oó]n\\s*de\\s*entrega', 'Direcci[oó]n',
    'Address', 'Domicilio', 'Ubicaci[oó]n', 'Donde\\s*desea\\s*recibir',
  ], normalizedText);

  let province = '';
  let canton = '';
  let district = '';
  const grouped = normalizedText.match(/(?:Provincia[,\/\s]*Cant[oó]n[,\/\s]*Distrito)\s*[:=|\-~]?\s*([^,\n]+),\s*([^,\n]+),\s*([^\.\n]+)/i);
  if (grouped) {
    province = grouped[1].trim().replace(/\.$/, '');
    canton = grouped[2].trim().replace(/\.$/, '');
    district = grouped[3].trim().replace(/\.$/, '');
  } else {
    province = extractField(['Provincia', 'Province'], normalizedText);
    canton = extractField(['Cant[oó]n', 'Canton'], normalizedText);
    district = extractField(['Distrito', 'District'], normalizedText);
  }

  let email = emailRaw;
  if (!email) email = normalizedText.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)?.[1] || '';

  let phone = phoneRaw;
  if (!phone) {
    for (const pattern of [/(\d{4}[\s\-]?\d{4})/, /(\d{8,})/, /(\+?\d{1,3}[\s\-]?\d{4}[\s\-]?\d{4})/]) {
      const match = normalizedText.match(pattern);
      if (match) { phone = match[1]; break; }
    }
  }
  phone = phone.replace(/[-\s]/g, '');

  let name = nameRaw;
  if (!name) {
    name = lines.find(line => {
      const clean = line.replace(/[📍☎️🏠✉️🗺️]/g, '').trim();
      return clean.length > 10 || clean.split(/\s+/).length >= 2;
    }) || lines[0] || '';
  }

  let address = addressRaw;
  if (!address) {
    const addressKeywords = ['casa', 'apartamento', 'condominio', 'edificio', 'residencial', 'metros', 'frente', 'costado', 'cruce', 'esquina', 'barrio', 'colonia'];
    address = lines.find(line => addressKeywords.some(keyword => line.toLowerCase().includes(keyword))) || '';
    if (!address) {
      address = lines.reduce((longest, line) => line.length > longest.length ? line : longest, '');
      if (address.length < 15) address = '';
    }
  }

  if (!province) {
    const provinces = ['San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'];
    province = lines.find(line => provinces.some(value => line.includes(value))) || '';
  }

  const selectedProvince = findProvince(String(current.province || ''));
  const selectedCanton = findCanton(selectedProvince, String(current.canton || ''));
  const provinceMatch = findProvince(province) || selectedProvince;
  const cantonMatch = findCanton(provinceMatch, canton) || selectedCanton;
  const districtMatch = cantonMatch?.distritos.find(value => normalizeCustomerPasteText(value) === normalizeCustomerPasteText(district));

  return {
    ...current,
    name: name.replace(/^(Nombre|Name)[:\-=|~]?\s*/i, '').trim(),
    phone,
    province: provinceMatch?.nombre || province,
    canton: cantonMatch?.nombre || canton,
    district: districtMatch || district,
    email,
    address: address.replace(/^(Dirección|Address)[:\-=|~]?\s*/i, '').trim(),
  } as T;
}
