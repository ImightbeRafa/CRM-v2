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
  aiPasteEnabled?: boolean;
  onAiReviewPendingChange?: (pending: boolean) => void;
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
  aiPasteEnabled: aiPasteEnabledProp,
  onAiReviewPendingChange,
}) => {
  const [cantonSearch, setCantonSearch] = useState(customerInfo.canton || '');
  const [districtSearch, setDistrictSearch] = useState(customerInfo.district || '');
  const [cantonSuggestionsOpen, setCantonSuggestionsOpen] = useState(false);
  const [districtSuggestionsOpen, setDistrictSuggestionsOpen] = useState(false);
  const [aiPasteEnabled, setAiPasteEnabled] = useState(Boolean(aiPasteEnabledProp));
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState<CustomerInfo | null>(null);
  const [aiSourceText, setAiSourceText] = useState('');
  const [aiSelectedFields, setAiSelectedFields] = useState<string[]>([]);
  const rawCustomerTextRef = useRef(rawCustomerText);

  useEffect(() => {
    rawCustomerTextRef.current = rawCustomerText;
    if (aiSuggestion && rawCustomerText !== aiSourceText) {
      setAiSuggestion(null);
      setAiSelectedFields([]);
      onAiReviewPendingChange?.(false);
    }
  }, [aiSourceText, aiSuggestion, onAiReviewPendingChange, rawCustomerText]);

  useEffect(() => {
    if (aiPasteEnabledProp !== undefined) return;
    const controller = new AbortController();
    fetch('/api/ventas/customer-paste/enhance', { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => setAiPasteEnabled(data?.enabled === true))
      .catch(() => undefined);
    return () => controller.abort();
  }, [aiPasteEnabledProp]);

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
    if (aiSuggestion && text !== aiSourceText) {
      setAiSuggestion(null);
      setAiSelectedFields([]);
      onAiReviewPendingChange?.(false);
    }
    if (!text.trim()) return;
    onCustomerInfoChange(parseCustomerPaste(text, customerInfo));
  };

  const requestAiEnhancement = async () => {
    if (!rawCustomerText.trim() || aiLoading) return;
    const submittedText = rawCustomerText;
    setAiLoading(true);
    setAiError('');
    setAiSuggestion(null);
    onAiReviewPendingChange?.(true);
    try {
      const response = await fetch('/api/ventas/customer-paste/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: submittedText, heuristic: customerInfo }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo mejorar el texto');
      if (rawCustomerTextRef.current !== submittedText) {
        onAiReviewPendingChange?.(false);
        return;
      }
      const suggestion = { ...customerInfo, ...data.suggestion } as CustomerInfo;
      const changed = ['name', 'phone', 'email', 'username', 'province', 'canton', 'district', 'address']
        .filter(field => String(suggestion[field] || '') !== String(customerInfo[field] || ''));
      setAiSourceText(submittedText);
      setAiSuggestion(suggestion);
      setAiSelectedFields(changed);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'No se pudo mejorar el texto');
      onAiReviewPendingChange?.(false);
    } finally {
      setAiLoading(false);
    }
  };

  const finishAiReview = (accept: boolean) => {
    if (accept && aiSuggestion) {
      const next = { ...customerInfo };
      for (const field of aiSelectedFields) next[field] = aiSuggestion[field];
      onCustomerInfoChange(next);
    }
    setAiSuggestion(null);
    setAiSelectedFields([]);
    onAiReviewPendingChange?.(false);
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
        {aiPasteEnabled && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-800 dark:bg-violet-950/20">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Opcional: envía este texto de cliente a Grok para sugerir correcciones. Nunca crea ni modifica pedidos.
              </p>
              <button
                type="button"
                disabled={aiLoading || rawCustomerText.trim().length < 3}
                onClick={requestAiEnhancement}
                className="rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {aiLoading ? 'Analizando…' : 'Mejorar con Grok'}
              </button>
            </div>
            {aiError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{aiError}</p>}
            {aiSuggestion && (
              <div className="mt-3 space-y-3 border-t border-violet-200 pt-3 dark:border-violet-800">
                <p className="text-sm font-medium">Revisa cada cambio antes de continuar</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {['name', 'phone', 'email', 'username', 'province', 'canton', 'district', 'address'].map(field => {
                    const before = String(customerInfo[field] || '');
                    const after = String(aiSuggestion[field] || '');
                    if (before === after) return null;
                    return (
                      <label key={field} className="flex gap-2 rounded border border-border bg-card p-2 text-xs">
                        <input
                          type="checkbox"
                          checked={aiSelectedFields.includes(field)}
                          onChange={(event) => setAiSelectedFields(current => event.target.checked
                            ? [...current, field]
                            : current.filter(value => value !== field))}
                        />
                        <span><strong>{field}</strong><br /><span className="text-muted-foreground">{before || 'Vacío'} →</span> {after || 'Vacío'}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => finishAiReview(true)} className="rounded bg-violet-600 px-3 py-2 text-sm text-white">Aplicar seleccionados</button>
                  <button type="button" onClick={() => finishAiReview(false)} className="rounded border border-border px-3 py-2 text-sm">Descartar</button>
                </div>
              </div>
            )}
          </div>
        )}
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
