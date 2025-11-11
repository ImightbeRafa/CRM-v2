import React from 'react';
import { CustomerInfo } from './types';

interface CustomerFormProps {
  customerInfo: CustomerInfo;
  onCustomerInfoChange: (info: CustomerInfo) => void;
  rawCustomerText: string;
  onRawCustomerTextChange: (text: string) => void;
  orderType: 'EA' | 'RA';
}

const CustomerForm: React.FC<CustomerFormProps> = ({
  customerInfo,
  onCustomerInfoChange,
  rawCustomerText,
  onRawCustomerTextChange,
  orderType,
}) => {
  const parseCustomerText = (text: string) => {
    const lines = text.split(/[\n\r]+/).map(line => line.trim()).filter(Boolean);
    
    // Enhanced patterns for both formats including emojis
    const labeledPatterns = {
      name: /(?:📍\s*)?Nombre(?:\s*completo)?[:|\-]?\s*([\wáéíóúñÁÉÍÓÚÑ\s]+?)(?=☎️|Teléfono|[\d]|Provincia|$)/i,
      phone: /(?:☎️\s*)?(?:Teléfono|Tel)[:|\-]?\s*([\d\-\s]+)/i,
      province: /🏠\s*Provincia[:|\-]?\s*([^,\n\d]+?)(?=Cantón|Distrito|$)/i,
      // Handle both "Provincia, Cantón, Distrito:" format and individual formats
      locationGroup: /(?:🏠\s*)?Provincia,\s*Cantón,\s*Distrito[:|\-]?\s*([^\n]+?)(?=Correo|Email|✉️|$)/i,
      canton: /Cantón[:|\-]?\s*([^,\n\d]+?)(?=Distrito|Email|$)/i,
      district: /Distrito[:|\-]?\s*([^,\n\d]+?)(?=Email|e-mail|Dirección|$)/i,
      email: /(?:✉️\s*)?(?:Email|e-mail|Correo\s*electrónico)[:|\-]?\s*([^\s,\n]+@[^\s,\n]+)/i,
      address: /(?:🗺️\s*)?(?:Dirección[^:]*|donde\s+desea\s+recibir\s+el\s+pedido|Dirección\s+exacta\s+donde\s+deseas\s+recibirlo)[:|\-]?\s*([^,\n].*?)(?=Rango|Horas|Email|$)/i,
    };

    const normalizedText = text.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ');
    
    const findMatch = (pattern: RegExp): string => {
      const match = normalizedText.match(pattern);
      return match && match[1] ? match[1].trim() : '';
    };

    // Check if we have any labeled fields
    const hasLabels = Object.values(labeledPatterns).some(pattern => 
      pattern.test(normalizedText)
    );

    let newCustomerInfo;
    if (hasLabels) {
      // First try to extract grouped location (Provincia, Cantón, Distrito: Guanacaste, Liberia, Liberia)
      const locationGroupMatch = normalizedText.match(labeledPatterns.locationGroup);
      let province = '', canton = '', district = '';
      
      if (locationGroupMatch && locationGroupMatch[1]) {
        const locationParts = locationGroupMatch[1].split(',').map(part => part.trim());
        province = locationParts[0] || '';
        canton = locationParts[1] || '';
        district = locationParts[2] || '';
      } else {
        // Fall back to individual patterns
        province = findMatch(labeledPatterns.province);
        canton = findMatch(labeledPatterns.canton);
        district = findMatch(labeledPatterns.district);
      }

      // Use labeled parsing
      newCustomerInfo = {
        ...customerInfo,
        name: findMatch(labeledPatterns.name),
        phone: findMatch(labeledPatterns.phone)?.replace(/[-\s]/g, ''),
        province,
        canton,
        district,
        email: findMatch(labeledPatterns.email),
        address: findMatch(labeledPatterns.address),
      };
    } else {
      // Use position-based parsing
      const emailLine = lines.find(line => line.includes('@')) || '';
      const phoneLine = lines.find(line => /^\d[\d\-\s]+$/.test(line)) || '';
      
      newCustomerInfo = {
        ...customerInfo,
        name: lines[0] || '',
        phone: phoneLine.replace(/[-\s]/g, ''),
        email: emailLine,
        province: lines.find(l => l.includes('José') || l.includes('Alajuela') || l.includes('Cartago') || l.includes('Heredia') || l.includes('Guanacaste') || l.includes('Puntarenas') || l.includes('Limón')) || '',
        canton: lines[3] || '',
        district: lines[4] || '',
        address: lines.find(l => l.includes('Condominio') || l.includes('casa') || l.includes('apartamento') || l.length > 50) || '',
      };
    }

    onRawCustomerTextChange(text);
    onCustomerInfoChange(newCustomerInfo);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    onCustomerInfoChange({
      ...customerInfo,
      [name]: value,
    });
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
          placeholder="📋 Pegar información del cliente aquí...&#10;&#10;Formatos soportados:&#10;• Nombre completo: [nombre]&#10;  Teléfono: [teléfono]&#10;  Provincia, Cantón, Distrito: [provincia], [cantón], [distrito]&#10;  Correo electrónico: [email]&#10;  Dirección exacta donde deseas recibirlo: [dirección]&#10;&#10;• 📍 Nombre completo: [nombre]&#10;  ☎️ Teléfono: [teléfono]&#10;  🏠 Provincia, Cantón, Distrito: [provincia], [cantón], [distrito]&#10;  ✉️ Correo electrónico: [email]&#10;  🗺️ Dirección exacta donde deseas recibirlo: [dirección]"
        />
      </div>

      {/* Customer Information Display */}
      <div className="mt-4 space-y-4 border rounded-lg p-4 bg-gray-50">
        <h3 className="font-medium text-lg">Info cliente:</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Common fields */}
          <div>
            <label className="block text-sm text-gray-600">
              {customerInfo.orderType === 'EA' ? 'Cliente' : 'Nombre'}
            </label>
            <input
              type="text"
              name="name"
              className="w-full p-2 bg-white border rounded"
              value={customerInfo.name}
              onChange={handleInputChange}
              placeholder="No detectado"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600">Teléfono</label>
            <input
              type="text"
              name="phone"
              className="w-full p-2 bg-white border rounded"
              value={customerInfo.phone}
              onChange={handleInputChange}
              placeholder="No detectado"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600">Email</label>
            <input
              type="email"
              name="email"
              className="w-full p-2 bg-white border rounded"
              value={customerInfo.email}
              onChange={handleInputChange}
              placeholder="No detectado"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600">Usuario</label>
            <input
              type="text"
              name="username"
              className="w-full p-2 bg-white border rounded"
              value={customerInfo.username}
              onChange={handleInputChange}
              placeholder="Usuario de Instagram/Facebook"
            />
          </div>

          {/* Location fields only for EA (shipping) */}
          {customerInfo.orderType === 'EA' && (
            <>
              <div>
                <label className="block text-sm text-gray-600">Provincia</label>
                <input
                  type="text"
                  name="province"
                  className="w-full p-2 bg-white border rounded"
                  value={customerInfo.province}
                  onChange={handleInputChange}
                  placeholder="No detectado"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600">Cantón</label>
                <input
                  type="text"
                  name="canton"
                  className="w-full p-2 bg-white border rounded"
                  value={customerInfo.canton}
                  onChange={handleInputChange}
                  placeholder="No detectado"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600">Distrito</label>
                <input
                  type="text"
                  name="district"
                  className="w-full p-2 bg-white border rounded"
                  value={customerInfo.district}
                  onChange={handleInputChange}
                  placeholder="No detectado"
                />
              </div>
              <div className="col-span-1 sm:col-span-2">
                <label className="block text-sm text-gray-600">Dirección</label>
                <textarea
                  name="address"
                  className="w-full p-2 bg-white border rounded"
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
          name="comentarios"
          className="w-full p-2 border rounded"
          value={(customerInfo as any).comentarios || ''}
          onChange={handleInputChange}
          placeholder="Anota detalles importantes del pedido (colores, personalización, observaciones, etc.)"
          rows={3}
        />
      </div>

    </div>
  );
};

export default CustomerForm;