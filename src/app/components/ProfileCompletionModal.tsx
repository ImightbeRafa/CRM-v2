'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Alert, AlertDescription } from '@/app/components/ui/alert';
import { Phone, MapPin, Building2, X, CheckCircle, User } from 'lucide-react';

interface ProfileCompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
  tenantName?: string;
  ownerName?: string;
}

// Costa Rica provinces
const CR_PROVINCES = [
  'San José',
  'Alajuela', 
  'Cartago',
  'Heredia',
  'Guanacaste',
  'Puntarenas',
  'Limón'
];

// Countries
const COUNTRIES = [
  { code: 'CR', name: 'Costa Rica', flag: '🇨🇷', phoneCode: '+506' },
  { code: 'PA', name: 'Panamá', flag: '🇵🇦', phoneCode: '+507' },
  { code: 'NI', name: 'Nicaragua', flag: '🇳🇮', phoneCode: '+505' },
  { code: 'GT', name: 'Guatemala', flag: '🇬🇹', phoneCode: '+502' },
  { code: 'SV', name: 'El Salvador', flag: '🇸🇻', phoneCode: '+503' },
  { code: 'HN', name: 'Honduras', flag: '🇭🇳', phoneCode: '+504' },
  { code: 'MX', name: 'México', flag: '🇲🇽', phoneCode: '+52' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴', phoneCode: '+57' },
  { code: 'US', name: 'United States', flag: '🇺🇸', phoneCode: '+1' },
  { code: 'OTHER', name: 'Otro', flag: '🌍', phoneCode: '' },
];

export default function ProfileCompletionModal({ 
  isOpen, 
  onClose, 
  onComplete,
  tenantName = '',
  ownerName = ''
}: ProfileCompletionModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState({
    businessName: tenantName,
    ownerName: ownerName,
    phone: '',
    country: 'CR',
    province: '',
  });
  const [dismissedUntil, setDismissedUntil] = useState<string | null>(null);

  useEffect(() => {
    // Check if user dismissed the modal recently
    const dismissed = localStorage.getItem('profileCompletionDismissed');
    if (dismissed) {
      const dismissedDate = new Date(dismissed);
      const now = new Date();
      // If dismissed less than 7 days ago, don't show
      if (now.getTime() - dismissedDate.getTime() < 7 * 24 * 60 * 60 * 1000) {
        setDismissedUntil(dismissed);
      }
    }
  }, []);

  if (!isOpen || dismissedUntil) return null;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
  };

  const handleDismiss = () => {
    // Save dismissal to localStorage for 7 days
    localStorage.setItem('profileCompletionDismissed', new Date().toISOString());
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!formData.phone.trim()) {
      setError('Por favor ingresa un teléfono de contacto');
      return;
    }
    const phoneDigits = formData.phone.replace(/\D/g, '');
    if (phoneDigits.length < 8) {
      setError('Por favor ingresa un número de teléfono válido');
      return;
    }
    if (!formData.country) {
      setError('Por favor selecciona tu país');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/tenant/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: formData.businessName,
          ownerName: formData.ownerName,
          phone: formData.phone,
          country: formData.country,
          province: formData.province,
        }),
      });

      if (response.ok) {
        setSuccess(true);
        // Clear dismissal flag
        localStorage.removeItem('profileCompletionDismissed');
        
        setTimeout(() => {
          onComplete?.();
          onClose();
        }, 1500);
      } else {
        const data = await response.json();
        setError(data.error || 'Error al actualizar el perfil');
      }
    } catch (error) {
      setError('Ocurrió un error. Por favor intenta de nuevo.');
    } finally {
      setIsLoading(false);
    }
  };

  const selectedCountry = COUNTRIES.find(c => c.code === formData.country);

  if (success) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <Card className="w-full max-w-md shadow-2xl">
          <CardContent className="pt-8 pb-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">¡Perfil Actualizado!</h3>
              <p className="text-gray-600">Tu información ha sido guardada correctamente.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="relative pb-2">
          <div className="absolute top-4 right-4 flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-400 hover:text-gray-600"
              onClick={handleDismiss}
            >
              Recordar después
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mb-4">
            <User className="w-7 h-7 text-blue-600" />
          </div>
          <CardTitle className="text-xl">Completa tu Perfil</CardTitle>
          <CardDescription>
            Necesitamos algunos datos para brindarte un mejor servicio
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="profile-owner">Tu Nombre</Label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="profile-owner"
                  name="ownerName"
                  type="text"
                  placeholder="Tu nombre completo"
                  value={formData.ownerName}
                  onChange={handleInputChange}
                  className="pl-10"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="profile-business">Nombre del Negocio</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="profile-business"
                  name="businessName"
                  type="text"
                  placeholder="Mi Tienda"
                  value={formData.businessName}
                  onChange={handleInputChange}
                  className="pl-10"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="profile-country">País *</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-gray-400 z-10" />
                <select
                  id="profile-country"
                  name="country"
                  value={formData.country}
                  onChange={handleInputChange}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-md bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  {COUNTRIES.map(country => (
                    <option key={country.code} value={country.code}>
                      {country.flag} {country.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            {formData.country === 'CR' && (
              <div className="space-y-2">
                <Label htmlFor="profile-province">Provincia</Label>
                <select
                  id="profile-province"
                  name="province"
                  value={formData.province}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-200 rounded-md bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Selecciona una provincia</option>
                  {CR_PROVINCES.map(prov => (
                    <option key={prov} value={prov}>{prov}</option>
                  ))}
                </select>
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="profile-phone">Teléfono de Contacto *</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <div className="flex">
                  <span className="inline-flex items-center px-3 bg-gray-100 border border-r-0 border-gray-200 rounded-l-md text-gray-500 text-sm">
                    {selectedCountry?.phoneCode || '+506'}
                  </span>
                  <Input
                    id="profile-phone"
                    name="phone"
                    type="tel"
                    placeholder="8888-8888"
                    value={formData.phone}
                    onChange={handleInputChange}
                    className="rounded-l-none"
                    required
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Para contactarte sobre tu cuenta si es necesario
              </p>
            </div>
            
            <div className="pt-2">
              <Button 
                type="submit" 
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700" 
                disabled={isLoading}
              >
                {isLoading ? 'Guardando...' : 'Guardar y Continuar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

