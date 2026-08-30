import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CustomerInfo } from './types';
import {
  costaRicaLocations,
  provinceNames,
  ProvinceData,
  CantonData,
} from './costaRicaLocations';
import { parseCustomerPaste } from '@/lib/customer-paste';

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
  fieldErrors?: Record<string, string>;
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
  fieldErrors = {},
}) => {
  const [cantonSearch, setCantonSearch] = useState(customerInfo.canton || '');
  const [districtSearch, setDistrictSearch] = useState(customerInfo.district || '');
  const [cantonSuggestionsOpen, setCantonSuggestionsOpen] = useState(false);
  const [districtSuggestionsOpen, setDistrictSuggestionsOpen] = useState(false);
  const [districtClearedNotice, setDistrictClearedNotice] = useState('');
  const [cantonUnresolved, setCantonUnresolved] = useState(false);
  const [districtUnresolved, setDistrictUnresolved] = useState(false);
  const rawCustomerTextRef = useRef(rawCustomerText);

  useEffect(() => {
    rawCustomerTextRef.current = rawCustomerText;
  }, [rawCustomerText]);

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
    rawCustomerTextRef.current = text;
    onRawCustomerTextChange(text);
    if (!text.trim()) return;
    onCustomerInfoChange(parseCustomerPaste(text, customerInfo));
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

  const districtIsValidForCanton = (provinceName: string, cantonName: string, districtName: string) => {
    const province = findProvince(provinceName);
    const canton = findCanton(province, cantonName);
    if (!canton || !districtName.trim()) return false;
    return canton.distritos.some((district) => normalizeText(district) === normalizeText(districtName));
  };

  const applyCantonMatch = (match: CantonWithProvince, options?: { preserveDistrict?: boolean }) => {
    const keepDistrict = options?.preserveDistrict
      && districtIsValidForCanton(match.province, match.canton, customerInfo.district);
    const nextDistrict = keepDistrict ? customerInfo.district : '';
    setCantonSearch(match.canton);
    setCantonUnresolved(false);
    onCustomerInfoChange({
      ...customerInfo,
      province: match.province,
      canton: match.canton,
      district: nextDistrict,
    });
    if (!keepDistrict && customerInfo.district) {
      setDistrictSearch('');
      setDistrictClearedNotice('Selecciona nuevamente el distrito porque cambió el cantón.');
    } else {
      setDistrictSearch(nextDistrict);
      setDistrictClearedNotice('');
    }
    setCantonSuggestionsOpen(false);
  };

  const applyDistrictMatch = (match: DistrictWithHierarchy) => {
    setDistrictSearch(match.district);
    setDistrictUnresolved(false);
    setDistrictClearedNotice('');
    onCustomerInfoChange({
      ...customerInfo,
      province: match.province,
      canton: match.canton,
      district: match.district,
    });
    setCantonSearch(match.canton);
    setDistrictSuggestionsOpen(false);
  };

  const commitCantonFromSearch = () => {
    const search = normalizeText(cantonSearch);
    if (!search) {
      if (customerInfo.canton) {
        onCustomerInfoChange({ ...customerInfo, canton: '', district: '' });
        setDistrictSearch('');
      }
      setCantonUnresolved(false);
      return;
    }
    if (normalizeText(customerInfo.canton) === search && customerInfo.canton) {
      setCantonUnresolved(false);
      return;
    }
    const inProvince = selectedProvince?.cantones.filter(
      (canton) => normalizeText(canton.nombre) === search,
    ) ?? [];
    if (inProvince.length === 1 && selectedProvince) {
      applyCantonMatch({ province: selectedProvince.nombre, canton: inProvince[0].nombre }, { preserveDistrict: true });
      return;
    }
    const exact = allCantons.filter((item) => normalizeText(item.canton) === search);
    const uniqueNames = new Set(exact.map((item) => `${item.province}:${item.canton}`));
    if (uniqueNames.size === 1) {
      applyCantonMatch(exact[0], { preserveDistrict: true });
      return;
    }
    setCantonUnresolved(true);
  };

  const commitDistrictFromSearch = () => {
    const search = normalizeText(districtSearch);
    if (!search) {
      if (customerInfo.district) {
        onCustomerInfoChange({ ...customerInfo, district: '' });
      }
      setDistrictUnresolved(false);
      return;
    }
    if (normalizeText(customerInfo.district) === search && customerInfo.district) {
      setDistrictUnresolved(false);
      return;
    }
    const scoped = selectedCanton && selectedProvince
      ? selectedCanton.distritos
        .filter((district) => normalizeText(district) === search)
        .map((district) => ({
          province: selectedProvince.nombre,
          canton: selectedCanton.nombre,
          district,
        }))
      : [];
    if (scoped.length === 1) {
      applyDistrictMatch(scoped[0]);
      return;
    }
    const exact = allDistricts.filter((item) => normalizeText(item.district) === search);
    if (exact.length === 1) {
      applyDistrictMatch(exact[0]);
      return;
    }
    setDistrictUnresolved(true);
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
          <div data-field="name">
            <label className="block text-sm text-muted-foreground">
              {customerInfo.orderType === 'EA' ? 'Cliente' : 'Nombre'} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              className={`w-full p-2 bg-card border rounded ${fieldErrors.name ? 'border-red-500' : ''}`}
              value={customerInfo.name}
              onChange={handleInputChange}
              placeholder="No detectado"
              aria-required="true"
              aria-invalid={Boolean(fieldErrors.name)}
            />
            {fieldErrors.name && <p className="text-sm text-red-600 mt-1">{fieldErrors.name}</p>}
          </div>
          <div data-field="phone">
            <label className="block text-sm text-muted-foreground">Teléfono <span className="text-red-500">*</span></label>
            <input
              type="text"
              name="phone"
              className={`w-full p-2 bg-card border rounded ${fieldErrors.phone ? 'border-red-500' : ''}`}
              value={customerInfo.phone}
              onChange={handleInputChange}
              placeholder="No detectado"
              aria-required="true"
              aria-invalid={Boolean(fieldErrors.phone)}
            />
            {fieldErrors.phone && <p className="text-sm text-red-600 mt-1">{fieldErrors.phone}</p>}
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
              <div data-field="province">
                <label className="block text-sm text-muted-foreground">Provincia <span className="text-red-500">*</span></label>
                <select
                  name="province"
                  className={`w-full p-2 bg-card border rounded ${fieldErrors.province ? 'border-red-500' : ''}`}
                  value={selectedProvince?.nombre || customerInfo.province}
                  onChange={handleProvinceChange}
                  aria-required="true"
                  aria-invalid={Boolean(fieldErrors.province)}
                >
                  <option value="">Seleccione provincia</option>
                  {provinceNames.map((province) => (
                    <option key={province} value={province}>
                      {province}
                    </option>
                  ))}
                </select>
                {fieldErrors.province && <p className="text-sm text-red-600 mt-1">{fieldErrors.province}</p>}
              </div>
              <div data-field="canton">
                <label className="block text-sm text-muted-foreground">Cantón <span className="text-red-500">*</span></label>
                <div className="space-y-1">
                  <input
                    type="text"
                    value={cantonSearch}
                    onChange={(e) => handleCantonSearch(e.target.value)}
                    onFocus={() => setCantonSuggestionsOpen(true)}
                    onBlur={() => {
                      commitCantonFromSearch();
                      setTimeout(() => setCantonSuggestionsOpen(false), 150);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitCantonFromSearch();
                        setCantonSuggestionsOpen(false);
                      }
                    }}
                    placeholder="Buscar cantón"
                    className={`w-full p-2 bg-card border rounded ${fieldErrors.canton || cantonUnresolved ? 'border-red-500' : ''}`}
                    aria-required="true"
                    aria-invalid={Boolean(fieldErrors.canton || cantonUnresolved)}
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
                {(cantonUnresolved || fieldErrors.canton) && (
                  <p className="text-sm text-red-600 mt-1">
                    {fieldErrors.canton || 'Elige un cantón de la lista. El texto escrito no se guarda solo.'}
                  </p>
                )}
              </div>
              <div data-field="district">
                <label className="block text-sm text-muted-foreground">Distrito <span className="text-red-500">*</span></label>
                <div className="space-y-1">
                  <input
                    type="text"
                    value={districtSearch}
                    onChange={(e) => handleDistrictSearch(e.target.value)}
                    onFocus={() => setDistrictSuggestionsOpen(true)}
                    onBlur={() => {
                      commitDistrictFromSearch();
                      setTimeout(() => setDistrictSuggestionsOpen(false), 150);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitDistrictFromSearch();
                        setDistrictSuggestionsOpen(false);
                      }
                    }}
                    placeholder="Buscar distrito"
                    className={`w-full p-2 bg-card border rounded ${fieldErrors.district || districtUnresolved ? 'border-red-500' : ''}`}
                    aria-required="true"
                    aria-invalid={Boolean(fieldErrors.district || districtUnresolved)}
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
                {districtClearedNotice && (
                  <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">{districtClearedNotice}</p>
                )}
                {(districtUnresolved || fieldErrors.district) && (
                  <p className="text-sm text-red-600 mt-1">
                    {fieldErrors.district || 'Elige un distrito de la lista. El texto escrito no se guarda solo.'}
                  </p>
                )}
              </div>
              <div className="col-span-1 sm:col-span-2" data-field="address">
                <label className="block text-sm text-muted-foreground">Dirección <span className="text-red-500">*</span></label>
                <textarea
                  name="address"
                  className={`w-full p-2 bg-card border rounded ${fieldErrors.address ? 'border-red-500' : ''}`}
                  value={customerInfo.address}
                  onChange={handleInputChange}
                  placeholder="No detectado"
                  rows={2}
                  aria-required="true"
                  aria-invalid={Boolean(fieldErrors.address)}
                />
                {fieldErrors.address && <p className="text-sm text-red-600 mt-1">{fieldErrors.address}</p>}
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
