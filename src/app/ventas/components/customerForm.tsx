import React, { useEffect, useMemo, useState } from 'react';
import { CustomerInfo } from './types';
import {
  costaRicaLocations,
  provinceNames,
  ProvinceData,
  CantonData,
} from './costaRicaLocations';

type CantonWithProvince = {
  province: string;
  canton: string;
};

type DistrictWithHierarchy = {
  province: string;
  canton: string;
  district: string;
};

interface CustomerFormProps {
  customerInfo: CustomerInfo;
  onCustomerInfoChange: (info: CustomerInfo) => void;
  rawCustomerText: string;
  onRawCustomerTextChange: (text: string) => void;
  orderType: 'EA' | 'RA';
}

const normalizeText = (value: string | undefined | null) => {
  const safeValue = (value ?? '').toString();
  return safeValue
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
};

const findProvince = (provinceName: string): ProvinceData | undefined => {
  const normalizedTarget = normalizeText(provinceName);
  return costaRicaLocations.find(
    (province) => normalizeText(province.nombre) === normalizedTarget
  );
};

const findCanton = (
  province: ProvinceData | undefined,
  cantonName: string
): CantonData | undefined => {
  if (!province) return undefined;
  const normalizedTarget = normalizeText(cantonName);
  return province.cantones.find(
    (canton) => normalizeText(canton.nombre) === normalizedTarget
  );
};

const CustomerForm: React.FC<CustomerFormProps> = ({
  customerInfo,
  onCustomerInfoChange,
  rawCustomerText,
  onRawCustomerTextChange,
  orderType,
}) => {
  const [cantonSearch, setCantonSearch] = useState(customerInfo.canton || '');
  const [districtSearch, setDistrictSearch] = useState(customerInfo.district || '');
  const [cantonSuggestionsOpen, setCantonSuggestionsOpen] = useState(false);
  const [districtSuggestionsOpen, setDistrictSuggestionsOpen] = useState(false);

  const selectedProvince = useMemo(
    () => findProvince(customerInfo.province),
    [customerInfo.province]
  );

  const cantonsForProvince = useMemo(
    () => selectedProvince?.cantones ?? [],
    [selectedProvince]
  );

  const selectedCanton = useMemo(
    () => findCanton(selectedProvince, customerInfo.canton),
    [selectedProvince, customerInfo.canton]
  );

  const districtsForCanton = useMemo(
    () => selectedCanton?.distritos ?? [],
    [selectedCanton]
  );

  const allCantons: CantonWithProvince[] = useMemo(
    () =>
      costaRicaLocations.flatMap((province) =>
        province.cantones.map((canton) => ({
          province: province.nombre,
          canton: canton.nombre,
        }))
      ),
    []
  );

  const allDistricts: DistrictWithHierarchy[] = useMemo(
    () =>
      costaRicaLocations.flatMap((province) =>
        province.cantones.flatMap((canton) =>
          canton.distritos.map((district) => ({
            province: province.nombre,
            canton: canton.nombre,
            district,
          }))
        )
      ),
    []
  );

  const cantonSearchResults = useMemo(() => {
    const search = normalizeText(cantonSearch);
    if (!search) return [];

    const selectedNormalized = normalizeText(customerInfo.canton || '');
    if (search === selectedNormalized && customerInfo.canton) {
      return [];
    }

    return allCantons
      .filter((item) => normalizeText(item.canton).includes(search))
      .slice(0, 10);
  }, [allCantons, cantonSearch, customerInfo.canton]);

  const districtSearchResults = useMemo(() => {
    const search = normalizeText(districtSearch);
    if (!search) return [];

    const selectedNormalized = normalizeText(customerInfo.district || '');
    if (search === selectedNormalized && customerInfo.district) {
      return [];
    }

    return allDistricts
      .filter((item) => normalizeText(item.district).includes(search))
      .slice(0, 10);
  }, [allDistricts, districtSearch, customerInfo.district]);

  const displayedCantonResults = useMemo(() => {
    if (cantonSearchResults.length > 0) {
      return cantonSearchResults;
    }

    if (selectedProvince) {
      const provinceSuggestions = selectedProvince.cantones
        .filter((canton) =>
          cantonSearch.trim() === ''
            ? true
            : normalizeText(canton.nombre).includes(normalizeText(cantonSearch))
        )
        .map((canton) => ({
          province: selectedProvince.nombre,
          canton: canton.nombre,
        }));

      if (provinceSuggestions.length > 0) {
        return provinceSuggestions.slice(0, 15);
      }
    }

    const globalSuggestions = allCantons.filter((item) =>
      cantonSearch.trim() === ''
        ? true
        : normalizeText(item.canton).includes(normalizeText(cantonSearch))
    );

    return globalSuggestions.slice(0, 15);
  }, [cantonSearchResults, cantonSearch, selectedProvince, allCantons]);

  const displayedDistrictResults = useMemo(() => {
    if (districtSearchResults.length > 0) {
      return districtSearchResults;
    }

    if (selectedProvince && selectedCanton) {
      const cantonSuggestions = selectedCanton.distritos
        .filter((district) =>
          districtSearch.trim() === ''
            ? true
            : normalizeText(district).includes(normalizeText(districtSearch))
        )
        .map((district) => ({
          province: selectedProvince.nombre,
          canton: selectedCanton.nombre,
          district,
        }));

      if (cantonSuggestions.length > 0) {
        return cantonSuggestions.slice(0, 15);
      }
    }

    const globalSuggestions = allDistricts.filter((item) =>
      districtSearch.trim() === ''
        ? true
        : normalizeText(item.district).includes(normalizeText(districtSearch))
    );

    return globalSuggestions.slice(0, 15);
  }, [districtSearchResults, districtSearch, selectedProvince, selectedCanton, allDistricts]);

  useEffect(() => {
    setCantonSearch(customerInfo.canton || '');
  }, [customerInfo.canton]);

  useEffect(() => {
    setDistrictSearch(customerInfo.district || '');
  }, [customerInfo.district]);

  const parseCustomerText = (text: string) => {
    if (!text.trim()) return;
    
    const lines = text.split(/[\n\r]+/).map(line => line.trim()).filter(Boolean);
    const normalizedText = text.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ');
    
    // ===== STRATEGY 1: Multi-pattern labeled extraction =====
    // Support for various separators: :, -, =, |, etc.
    const separators = '[:=|\\-~]';
    
    const extractField = (keywords: string[], wholeText: string): string => {
      // Try each keyword with flexible separators
      for (const keyword of keywords) {
        // Pattern 1: Label with separator and content until next field or end
        const pattern1 = new RegExp(
          `(?:📍|☎️|🏠|✉️|🗺️)?\\s*${keyword}\\s*${separators}?\\s*([^\\n]+?)(?=(?:Nombre|Tel[eé]fono|Tel|Provincia|Cant[oó]n|Distrito|Correo|Email|Direcci[oó]n|$))`,
          'i'
        );
        const match1 = wholeText.match(pattern1);
        if (match1 && match1[1].trim()) return match1[1].trim();
        
        // Pattern 2: Label with separator on its own line or inline
        const pattern2 = new RegExp(`${keyword}\\s*${separators}\\s*(.+?)(?=\\n|$)`, 'i');
        const match2 = wholeText.match(pattern2);
        if (match2 && match2[1].trim()) return match2[1].trim();
      }
      return '';
    };
    
    // Extract with multiple keyword variations
    const nameRaw = extractField([
      'Nombre\\s*completo',
      'Nombre',
      'Name',
      'Cliente',
      'Comprador'
    ], normalizedText);
    
    const phoneRaw = extractField([
      'Tel[eé]fono',
      'Tel[eé]f',
      'Tel',
      'Phone',
      'Celular',
      'M[oó]vil',
      'Contacto'
    ], normalizedText);
    
    const emailRaw = extractField([
      'Correo\\s*electr[oó]nico',
      'Correo',
      'Email',
      'e-mail',
      'E-mail',
      'Mail'
    ], normalizedText);
    
    const addressRaw = extractField([
      'Direcci[oó]n\\s*exacta\\s*donde\\s*deseas?\\s*recibirlo',
      'Direcci[oó]n\\s*exacta',
      'Direcci[oó]n\\s*de\\s*entrega',
      'Direcci[oó]n',
      'Address',
      'Domicilio',
      'Ubicaci[oó]n',
      'Donde\\s*desea\\s*recibir'
    ], normalizedText);
    
    // ===== STRATEGY 2: Location extraction with multiple formats =====
    let province = '', canton = '', district = '';
    
    // Try grouped format: "Provincia/Cantón/Distrito: X, Y, Z" or "Provincia, Cantón, Distrito: X, Y, Z"
    const locationGroupPattern = /(?:Provincia[,\/\s]*Cant[oó]n[,\/\s]*Distrito)\s*[:=|\-~]?\s*([^,\n]+),\s*([^,\n]+),\s*([^.\n]+)/i;
    const locationGroupMatch = normalizedText.match(locationGroupPattern);
    
    if (locationGroupMatch) {
      province = locationGroupMatch[1].trim().replace(/\.$/, '');
      canton = locationGroupMatch[2].trim().replace(/\.$/, '');
      district = locationGroupMatch[3].trim().replace(/\.$/, '');
    } else {
      // Try individual extraction
      province = extractField(['Provincia', 'Province'], normalizedText);
      canton = extractField(['Cant[oó]n', 'Canton'], normalizedText);
      district = extractField(['Distrito', 'District'], normalizedText);
    }
    
    // ===== STRATEGY 3: Smart content-based detection (fallback) =====
    // If labeled extraction failed, use intelligent content detection
    
    // Email: anything with @ symbol
    let email = emailRaw;
    if (!email) {
      const emailMatch = normalizedText.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      email = emailMatch ? emailMatch[1] : '';
    }
    
    // Phone: Look for 8+ consecutive digits (with optional separators)
    let phone = phoneRaw;
    if (!phone) {
      // Try to find phone in any line
      const phonePatterns = [
        /(\d{4}[\s\-]?\d{4})/,  // 8 digits with optional separator
        /(\d{8,})/,              // 8+ consecutive digits
        /(\+?\d{1,3}[\s\-]?\d{4}[\s\-]?\d{4})/ // International format
      ];
      
      for (const pattern of phonePatterns) {
        const match = normalizedText.match(pattern);
        if (match) {
          phone = match[1];
          break;
        }
      }
    }
    phone = phone.replace(/[-\s]/g, ''); // Clean phone number
    
    // Name: If not found, use first substantial line (more than 3 words or 10 chars)
    let name = nameRaw;
    if (!name) {
      name = lines.find(line => {
        const cleanLine = line.replace(/[📍☎️🏠✉️🗺️]/g, '').trim();
        return cleanLine.length > 10 || cleanLine.split(/\s+/).length >= 2;
      }) || lines[0] || '';
    }
    
    // Address: If not found, look for longest line or one with address keywords
    let address = addressRaw;
    if (!address) {
      const addressKeywords = ['casa', 'apartamento', 'condominio', 'edificio', 'residencial', 'metros', 'frente', 'costado', 'cruce', 'esquina', 'barrio', 'colonia'];
      address = lines.find(l => addressKeywords.some(kw => l.toLowerCase().includes(kw))) || '';
      
      // If still nothing, take longest line (likely the address)
      if (!address) {
        address = lines.reduce((longest, current) => 
          current.length > longest.length ? current : longest, ''
        );
        // But only if it's substantial
        if (address.length < 15) address = '';
      }
    }
    
    // Province: Check common Costa Rican provinces
    if (!province) {
      const provinces = ['San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'];
      province = lines.find(l => provinces.some(p => l.includes(p))) || '';
    }
    
    // ===== Build result =====
    const provinceMatch = findProvince(province) || selectedProvince;
    const cantonMatch = findCanton(provinceMatch, canton) || selectedCanton;
    const districtMatch = cantonMatch?.distritos.find(
      (d) => normalizeText(d) === normalizeText(district)
    );

    const newCustomerInfo = {
      ...customerInfo,
      name: name.replace(/^(Nombre|Name)[:\-=|~]?\s*/i, '').trim(),
      phone,
      province: provinceMatch?.nombre || province,
      canton: cantonMatch?.nombre || canton,
      district: districtMatch || district,
      email,
      address: address.replace(/^(Dirección|Address)[:\-=|~]?\s*/i, '').trim(),
    };

    onRawCustomerTextChange(text);
    onCustomerInfoChange(newCustomerInfo);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    onCustomerInfoChange({
      ...customerInfo,
      [name]: value,
    });
  };

  const handleProvinceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    const province = costaRicaLocations.find((p) => p.nombre === value);

    onCustomerInfoChange({
      ...customerInfo,
      province: province ? province.nombre : value,
      canton: '',
      district: '',
    });
    setCantonSearch('');
    setDistrictSearch('');
  };

  const handleCantonSearch = (value: string) => {
    setCantonSearch(value);
    setCantonSuggestionsOpen(true);
  };

  const handleDistrictSearch = (value: string) => {
    setDistrictSearch(value);
    setDistrictSuggestionsOpen(true);
  };

  const applyCantonMatch = (match: CantonWithProvince) => {
    setCantonSearch(match.canton);
    onCustomerInfoChange({
      ...customerInfo,
      province: match.province,
      canton: match.canton,
      district: '',
    });
    setDistrictSearch('');
    setCantonSuggestionsOpen(false);
  };

  const applyDistrictMatch = (match: DistrictWithHierarchy) => {
    setDistrictSearch(match.district);
    onCustomerInfoChange({
      ...customerInfo,
      province: match.province,
      canton: match.canton,
      district: match.district,
    });
    setCantonSearch(match.canton);
    setDistrictSuggestionsOpen(false);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    parseCustomerText(pastedText);
  };

  return (
    <div className="space-y-6">
      {/* Customer Info Paste Area */}
      <div className="space-y-2">
        <label className="block font-medium">
          Información del Cliente (Pegar texto)
        </label>
        <textarea 
          className="w-full h-32 p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          value={rawCustomerText}
          onChange={(e) => parseCustomerText(e.target.value)}
          onPaste={handlePaste}
          placeholder="📋 Pegar información del cliente aquí...&#10;&#10;✅ Acepta múltiples formatos:&#10;• Con etiquetas: Nombre: Carlos | Tel: 88979856 | Email: test@mail.com&#10;• Con emojis: 📍 Nombre - Juan | ☎️ Teléfono: 88887777&#10;• Ubicación: Provincia/Cantón/Distrito: Alajuela, Alajuela, Carrizal&#10;• Sin etiquetas: Detecta emails (@), teléfonos (8+ dígitos), direcciones&#10;• Separadores flexibles: : - = | ~&#10;&#10;💡 Inteligente: Si no encuentra etiquetas, analiza el contenido automáticamente"
        />
      </div>

      {/* Customer Information Display */}
      <div className="mt-4 space-y-4 border rounded-lg p-4 bg-muted">
        <h3 className="font-medium text-lg">Info cliente:</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Common fields */}
          <div>
            <label className="block text-sm text-muted-foreground">
              {customerInfo.orderType === 'EA' ? 'Cliente' : 'Nombre'}
            </label>
            <input
              type="text"
              name="name"
              className="w-full p-2 bg-card border rounded"
              value={customerInfo.name}
              onChange={handleInputChange}
              placeholder="No detectado"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground">Teléfono</label>
            <input
              type="text"
              name="phone"
              className="w-full p-2 bg-card border rounded"
              value={customerInfo.phone}
              onChange={handleInputChange}
              placeholder="No detectado"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground">Email</label>
            <input
              type="email"
              name="email"
              className="w-full p-2 bg-card border rounded"
              value={customerInfo.email}
              onChange={handleInputChange}
              placeholder="No detectado"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground">Usuario</label>
            <input
              type="text"
              name="username"
              className="w-full p-2 bg-card border rounded"
              value={customerInfo.username}
              onChange={handleInputChange}
              placeholder="Usuario de Instagram/Facebook"
            />
          </div>

          {/* Location fields only for EA (shipping) */}
          {customerInfo.orderType === 'EA' && (
            <>
              <div>
                <label className="block text-sm text-muted-foreground">Provincia</label>
                <select
                  name="province"
                  className="w-full p-2 bg-card border rounded"
                  value={selectedProvince?.nombre || customerInfo.province}
                  onChange={handleProvinceChange}
                >
                  <option value="">Seleccione provincia</option>
                  {provinceNames.map((province) => (
                    <option key={province} value={province}>
                      {province}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-muted-foreground">Cantón</label>
                <div className="space-y-1">
                  <input
                    type="text"
                    value={cantonSearch}
                    onChange={(e) => handleCantonSearch(e.target.value)}
                    onFocus={() => setCantonSuggestionsOpen(true)}
                    onBlur={() => setTimeout(() => setCantonSuggestionsOpen(false), 150)}
                    placeholder="Buscar cantón"
                    className="w-full p-2 bg-card border rounded"
                  />
                  {cantonSuggestionsOpen && (
                    <div className="max-h-48 overflow-y-auto border rounded bg-card shadow-sm">
                      {displayedCantonResults.length > 0 ? (
                        displayedCantonResults.map((result) => (
                          <button
                            key={`${result.province}-${result.canton}`}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              applyCantonMatch({
                                province: result.province,
                                canton: result.canton,
                              });
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                          >
                            <div className="font-medium text-foreground">{result.canton}</div>
                            <div className="text-xs text-muted-foreground">{result.province}</div>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No se encontraron cantones.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm text-muted-foreground">Distrito</label>
                <div className="space-y-1">
                  <input
                    type="text"
                    value={districtSearch}
                    onChange={(e) => handleDistrictSearch(e.target.value)}
                    onFocus={() => setDistrictSuggestionsOpen(true)}
                    onBlur={() => setTimeout(() => setDistrictSuggestionsOpen(false), 150)}
                    placeholder="Buscar distrito"
                    className="w-full p-2 bg-card border rounded"
                  />
                  {districtSuggestionsOpen && (
                    <div className="max-h-48 overflow-y-auto border rounded bg-card shadow-sm">
                      {displayedDistrictResults.length > 0 ? (
                        displayedDistrictResults.map((result) => (
                          <button
                            key={`${result.province}-${result.canton}-${result.district}`}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              applyDistrictMatch(result);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                          >
                            <div className="font-medium text-foreground">{result.district}</div>
                            <div className="text-xs text-muted-foreground">
                              {result.canton} • {result.province}
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No se encontraron distritos.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="col-span-1 sm:col-span-2">
                <label className="block text-sm text-muted-foreground">Dirección</label>
                <textarea
                  name="address"
                  className="w-full p-2 bg-card border rounded"
                  value={customerInfo.address}
                  onChange={handleInputChange}
                  placeholder="No detectado"
                  rows={2}
                />
              </div>
            </>
          )}
        </div>
      </div>


      {/* Date fields */}
      <div className="grid grid-cols-2 gap-4">
        {customerInfo.orderType === 'RA' && (
          <div>
            <label className="block font-medium">Fecha de Retiro</label>
            <input
              type="date"
              name="fechaRetiro"
              className="w-full p-2 border rounded"
              value={customerInfo.fechaRetiro}
              onChange={handleInputChange}
            />
          </div>
        )}
      </div>

      {/* Seller Comments (Order-level) */}
      <div className="mt-4 space-y-2">
        <label className="block font-medium">Comentarios del vendedor</label>
        <textarea
          name="comments"
          className="w-full p-2 border rounded"
          value={customerInfo.comments ?? (customerInfo as any).comentarios ?? ''}
          onChange={handleInputChange}
          placeholder="Anota detalles importantes del pedido (colores, personalización, observaciones, etc.)"
          rows={3}
        />
      </div>

    </div>
  );
};

export default CustomerForm;
