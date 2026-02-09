import React, { useEffect, useMemo, useState } from 'react';
import { ProductInfo } from './types';
import { RefreshCw } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';

interface ProductFormProps {
  productInfo: ProductInfo;
  orderType: 'EA' | 'RA';
  onProductInfoChange: (info: ProductInfo) => void;
  applyIVA: boolean;
  onApplyIVAChange: (value: boolean) => void;
  isAddModal?: boolean;
}

const ProductForm: React.FC<ProductFormProps> = ({
  productInfo,
  orderType,
  onProductInfoChange,
  applyIVA,
  onApplyIVAChange,
  isAddModal = false,
}) => {
  const { user } = useCurrentUser();

  // Auto-assign vendedor when user is loaded
  useEffect(() => {
    // Check if vendedor is empty string (not just falsy) to properly auto-assign
    if (user && (!productInfo.vendedor || productInfo.vendedor.trim() === '')) {
      onProductInfoChange({
        ...productInfo,
        vendedor: user.username
      });
    }
  }, [user, productInfo.vendedor]);

  const recalcProduct = (info: ProductInfo): ProductInfo => {
    // Recompute option deltas based on current dynamic selections
    let computedOptionDeltas = 0;
    fields.forEach(field => {
      if (field.optionSet && field.optionSet.options) {
        const selectedValue = (info as any)[field.key];
        if (selectedValue) {
          const option = field.optionSet.options.find((o: any) => o.value === selectedValue);
          if (option) computedOptionDeltas += option.priceDelta || 0;
        }
      }
    });

    const baseSubtotal = info.productCost * info.cantidad;
    const subtotalWithOptions = baseSubtotal + computedOptionDeltas;
    const ivaAmount = applyIVA ? subtotalWithOptions * 0.13 : 0;
    const totalAmount = subtotalWithOptions + ivaAmount;

    return {
      ...info,
      optionDeltas: computedOptionDeltas,
      iva: ivaAmount,
      total: totalAmount,
    };
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const isNumeric = ['productCost', 'cantidad'].includes(name);
    const parsedValue = isNumeric ? (value === '' ? 0 : parseFloat(value)) : value;

    const nextInfo = {
      ...productInfo,
      [name]: isNumeric ? (isNaN(parsedValue as number) ? 0 : parsedValue) : parsedValue
    } as unknown as ProductInfo;

    onProductInfoChange(recalcProduct(nextInfo));
  };

  const [fields, setFields] = useState<any[]>([])
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [isMounted, setIsMounted] = useState(true)

  const loadData = async () => {
    try {
      if (!isMounted) return;
      setLoading(true)
      const [fRes, sRes, setsRes] = await Promise.all([
        fetch('/api/config/fields'),
        fetch('/api/config/sellers'),
        fetch('/api/config/option-sets')
      ])
      const [fJson, sJson, setsJson] = await Promise.all([fRes.json(), sRes.json(), setsRes.json()])
      if (fJson.status === 'success' && isMounted) {
        let nextFields = fJson.data
        // Defensive fix: some select fields might be missing linked optionSet
        if (setsJson?.status === 'success') {
          const setByKey: Record<string, any> = {}
            ; (setsJson.data || []).forEach((set: any) => { setByKey[set.key] = set })
          nextFields = nextFields.map((fld: any) => {
            if ((fld.type === 'select' || fld.type === 'multiselect') && (!fld.optionSet || (fld.optionSet.options || []).length === 0)) {
              const guess = setByKey[fld.key]
              if (guess) {
                return { ...fld, optionSet: guess }
              }
            }
            return fld
          })
        }
        setFields(nextFields)
      }
      if (sJson.status === 'success' && isMounted) setSellers(sJson.data)
    } catch (error) {
      console.error('Error loading form data:', error)
    } finally {
      if (isMounted) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Refresh data when component becomes visible (for new options)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && isMounted) {
        loadData()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      setIsMounted(false)
    }
  }, [isMounted])

  // No per-product shipping calculation; shipping is handled at order level

  // Calculate option price deltas
  const optionDeltas = useMemo(() => {
    let total = 0
    fields.forEach(field => {
      if (field.optionSet && field.optionSet.options) {
        const selectedValue = (productInfo as any)[field.key]
        if (selectedValue) {
          const option = field.optionSet.options.find((o: any) => o.value === selectedValue)
          if (option) total += option.priceDelta || 0
        }
      }
    })
    return total
  }, [fields, productInfo])

  return (
    <div className="space-y-6">
      {/* Product Information Header */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-lg font-semibold text-blue-800 mb-2">📦 Información del Producto</h3>
            <p className="text-sm text-blue-600">Configure los detalles del producto que está vendiendo</p>
          </div>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1 text-sm bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-md transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Cargando...' : 'Actualizar'}
          </button>
        </div>
      </div>


      {/* Basic fields for add modal use-case */}
      {isAddModal && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block font-medium text-sm text-gray-700 mb-1">Nombre del producto *</label>
            <input
              type="text"
              name="type"
              className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={productInfo.type}
              onChange={handleInputChange}
              required
              placeholder="Ej: Camiseta personalizada"
            />
          </div>
          <div>
            <label className="block font-medium text-sm text-gray-700 mb-1">Cantidad *</label>
            <input
              type="number"
              name="cantidad"
              className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={productInfo.cantidad}
              onChange={handleInputChange}
              min={1}
              required
            />
          </div>
          <div>
            <label className="block font-medium text-sm text-gray-700 mb-1">Costo unitario *</label>
            <input
              type="number"
              name="productCost"
              className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={productInfo.productCost}
              onChange={handleInputChange}
              min={0}
              step="any"
              required
            />
          </div>
          {/* Per-product shipping removed; handled at order level */}
        </div>
      )}

      {/* Dynamic Fields */}
      {loading ? (
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span className="ml-2 text-gray-600">Cargando campos personalizados...</span>
          </div>
        </div>
      ) : fields.length > 0 ? (
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-medium text-gray-800 mb-3">Campos Personalizados</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fields.map((field) => {
              // Avoid duplicating comments if a dynamic field is configured with key 'comments'
              if (field.key === 'comments') return null
              // Exclude shipping method field as it's handled separately in order summary
              if (field.key === 'metodoEnvio' || field.key === 'metodo_envio' || field.key === 'shipping_method' ||
                field.key === 'metodoEnvio' || field.key === 'metodo_envio' || field.key === 'shipping_method' ||
                field.label?.toLowerCase().includes('método de envío') ||
                field.label?.toLowerCase().includes('metodo de envio') ||
                field.label?.toLowerCase().includes('shipping') ||
                field.key?.toLowerCase().includes('envio') && field.key?.toLowerCase().includes('metodo')) return null
              const name = field.key as keyof ProductInfo
              if (field.type === 'text' || field.type === 'number') {
                return (
                  <div key={field.id}>
                    <label className="block font-medium text-sm text-gray-700 mb-1">
                      {field.label}{field.required ? ' *' : ''}
                    </label>
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      name={name as string}
                      className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={(productInfo as any)[name] || ''}
                      onChange={handleInputChange}
                      required={field.required}
                      placeholder={field.type === 'number' ? '0' : `Ingrese ${field.label.toLowerCase()}`}
                    />
                  </div>
                )
              }
              if (field.type === 'boolean') {
                return (
                  <div key={field.id} className="flex items-center gap-2 p-2 bg-white rounded border">
                    <input
                      type="checkbox"
                      name={name as string}
                      checked={Boolean((productInfo as any)[name])}
                      onChange={(e) => {
                        const next = { ...productInfo, [name]: e.target.checked ? 'Sí' : '' } as unknown as ProductInfo
                        onProductInfoChange(recalcProduct(next))
                      }}
                      className="w-4 h-4"
                    />
                    <label className="font-medium text-sm text-gray-700">{field.label}</label>
                  </div>
                )
              }
              if (field.type === 'select' || field.type === 'multiselect') {
                const options = field.optionSet?.options || []
                return (
                  <div key={field.id}>
                    <label className="block font-medium text-sm text-gray-700 mb-1">
                      {field.label}{field.required ? ' *' : ''}
                    </label>
                    <select
                      name={name as string}
                      className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={(productInfo as any)[name] || ''}
                      onChange={handleInputChange}
                      required={field.required}
                      multiple={field.multiSelect}
                    >
                      {!field.multiSelect && <option value="">Seleccionar {field.label}</option>}
                      {options.map((opt: any) => (
                        <option key={opt.id} value={opt.value}>
                          {opt.label} {opt.priceDelta ? `(+₡${opt.priceDelta})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              }
              return null
            })}
          </div>
        </div>
      ) : null}




      {/* Vendor Information - Only show in edit mode, not in add modal */}
      {!isAddModal && (
        <div className="flex flex-col space-y-1">
          <label className="text-sm font-medium">Vendedor</label>
          <input
            type="text"
            name="vendedor"
            className="w-full p-2 border rounded text-sm bg-gray-50"
            value={productInfo.vendedor || user?.username || ''}
            readOnly
            title="Vendedor asignado automáticamente"
          />
        </div>
      )}

      {/* Costs - Only show in edit mode, not in add modal */}
      {!isAddModal && (
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col space-y-1">
            <label className="text-sm font-medium">Costo del Producto</label>
            <input
              type="number"
              name="productCost"
              value={productInfo.productCost}
              onChange={handleInputChange}
              className="w-full p-2 border rounded text-sm"
              min="0"
              step="any"
              required
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="text-sm font-medium">Cantidad</label>
            <input
              type="number"
              name="cantidad"
              value={productInfo.cantidad}
              onChange={handleInputChange}
              className="w-full p-2 border rounded text-sm"
              min="1"
              step="1"
              required
            />
          </div>
          {/* Per-product shipping removed; handled at order level */}
        </div>
      )}

    </div>
  );
};

export default ProductForm;