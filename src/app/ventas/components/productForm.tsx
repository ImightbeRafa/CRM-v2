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
    if (user && !productInfo.vendedor) {
      onProductInfoChange({
        ...productInfo,
        vendedor: user.username
      });
    }
  }, [user, productInfo.vendedor]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    let numValue = value;

    // Convert to number for numeric fields
    if (['productCost', 'shippingCost', 'cantidad'].includes(name)) {
      numValue = value === '' ? '0' : value;
      const newInfo = {
        ...productInfo,
        [name]: parseFloat(numValue) || 0
      };

      // Calculate total with option deltas
      const subtotal = newInfo.productCost * newInfo.cantidad;
      const shipping = orderType === 'EA' ? newInfo.shippingCost : 0;
      const iva = applyIVA ? subtotal * 0.13 : 0;
      const total = subtotal + shipping + iva;

      onProductInfoChange({
        ...newInfo,
        iva: iva,
        total: total
      });
    } else {
      onProductInfoChange({
        ...productInfo,
        [name]: value
      });
    }
  };

  const [fields, setFields] = useState<any[]>([])
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([])
  const [shippingMethods, setShippingMethods] = useState<{ id: string; name: string; basePrice: number }[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    try {
      setLoading(true)
      const [fRes, sRes, shipRes] = await Promise.all([
        fetch('/api/config/fields'),
        fetch('/api/config/sellers'),
        fetch('/api/config/shipping'),
      ])
      const [fJson, sJson, shipJson] = await Promise.all([fRes.json(), sRes.json(), shipRes.json()])
      if (fJson.status === 'success') setFields(fJson.data)
      if (sJson.status === 'success') setSellers(sJson.data)
      if (shipJson.status === 'success') setShippingMethods(shipJson.data)
    } catch (error) {
      console.error('Error loading form data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Refresh data when component becomes visible (for new options)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadData()
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  const shippingBase = useMemo(() => {
    const m = shippingMethods.find(m => m.name === productInfo.mensajeria)
    return m ? m.basePrice : 0
  }, [shippingMethods, productInfo.mensajeria])

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
                      onChange={(e) => onProductInfoChange({ ...productInfo, [name]: e.target.checked ? 'Sí' : '' } as any)} 
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

      {/* Comments */}
      <div>
        <label className="block font-medium">Comentarios</label>
        <textarea
          name="comments"
          className="w-full p-2 border rounded"
          value={productInfo.comments}
          onChange={handleInputChange}
          rows={2}
        />
      </div>


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

        </div>
      )}

    </div>
  );
};

export default ProductForm;