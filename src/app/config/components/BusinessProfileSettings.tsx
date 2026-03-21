'use client';

import { useState, useEffect } from 'react';
import { Building2, User, Phone, MapPin, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

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

interface ProfileData {
  id: string;
  name: string;
  businessName: string | null;
  ownerName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  country: string | null;
  province: string | null;
  profileCompleted: boolean;
  plan: string;
  createdAt: string;
}

export function BusinessProfileSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [formData, setFormData] = useState({
    businessName: '',
    ownerName: '',
    phone: '',
    country: 'CR',
    province: '',
  });

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/profile');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.profile) {
          setProfile(data.profile);
          setFormData({
            businessName: data.profile.businessName || data.profile.name || '',
            ownerName: data.profile.ownerName || '',
            phone: data.profile.phone || '',
            country: data.profile.country || 'CR',
            province: data.profile.province || '',
          });
        }
      } else {
        setError('Error al cargar el perfil');
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
      setError('Error al cargar el perfil');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
    setSuccess('');
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
      setError('Por favor ingresa un número de teléfono válido (mínimo 8 dígitos)');
      return;
    }
    if (!formData.country) {
      setError('Por favor selecciona tu país');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/tenant/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        const data = await res.json();
        setSuccess('Perfil actualizado correctamente');
        if (data.profile) {
          setProfile(prev => prev ? { ...prev, ...data.profile } : data.profile);
        }
        // Clear dismissal so the modal doesn't show again
        localStorage.removeItem('profileCompletionDismissed');
      } else {
        const data = await res.json();
        setError(data.error || 'Error al actualizar el perfil');
      }
    } catch (err) {
      console.error('Error updating profile:', err);
      setError('Error al actualizar el perfil');
    } finally {
      setSaving(false);
    }
  };

  const selectedCountry = COUNTRIES.find(c => c.code === formData.country);

  if (loading) {
    return (
      <div className="bg-card rounded-xl shadow-lg border border-border p-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="ml-3 text-muted-foreground">Cargando perfil...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl shadow-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-white bg-opacity-20 rounded-xl">
            <Building2 className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Perfil del Negocio</h2>
            <p className="text-blue-100">Información de contacto y ubicación de tu negocio</p>
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Profile Status */}
        <div className={`mb-6 p-4 rounded-lg flex items-start gap-3 ${
          profile?.profileCompleted 
            ? 'bg-green-50 border border-green-200' 
            : 'bg-yellow-50 border border-yellow-200'
        }`}>
          {profile?.profileCompleted ? (
            <>
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
              <div>
                <p className="font-medium text-green-800">Perfil completo</p>
                <p className="text-sm text-green-600">Tu información de negocio está actualizada</p>
              </div>
            </>
          ) : (
            <>
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-800">Perfil incompleto</p>
                <p className="text-sm text-yellow-600">
                  Completa tu información para mejorar tu experiencia con Betsy
                </p>
              </div>
            </>
          )}
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}
        
        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
            <CheckCircle className="w-5 h-5" />
            {success}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Owner Name */}
            <div className="space-y-2">
              <label htmlFor="ownerName" className="block text-sm font-medium text-muted-foreground">
                Tu Nombre
              </label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <input
                  id="ownerName"
                  name="ownerName"
                  type="text"
                  value={formData.ownerName}
                  onChange={handleInputChange}
                  placeholder="Tu nombre completo"
                  className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Business Name */}
            <div className="space-y-2">
              <label htmlFor="businessName" className="block text-sm font-medium text-muted-foreground">
                Nombre del Negocio
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <input
                  id="businessName"
                  name="businessName"
                  type="text"
                  value={formData.businessName}
                  onChange={handleInputChange}
                  placeholder="Nombre de tu empresa o tienda"
                  className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Country */}
            <div className="space-y-2">
              <label htmlFor="country" className="block text-sm font-medium text-muted-foreground">
                País <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground z-10" />
                <select
                  id="country"
                  name="country"
                  value={formData.country}
                  onChange={handleInputChange}
                  className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-card focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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

            {/* Province (only for Costa Rica) */}
            {formData.country === 'CR' && (
              <div className="space-y-2">
                <label htmlFor="province" className="block text-sm font-medium text-muted-foreground">
                  Provincia
                </label>
                <select
                  id="province"
                  name="province"
                  value={formData.province}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-border rounded-lg bg-card focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Selecciona una provincia</option>
                  {CR_PROVINCES.map(prov => (
                    <option key={prov} value={prov}>{prov}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Phone */}
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="phone" className="block text-sm font-medium text-muted-foreground">
                Teléfono de Contacto <span className="text-red-500">*</span>
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-4 bg-muted border border-r-0 border-border rounded-l-lg text-muted-foreground text-sm font-medium">
                  {selectedCountry?.phoneCode || '+506'}
                </span>
                <div className="relative flex-1">
                  <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={handleInputChange}
                    placeholder="8888-8888"
                    className="w-full pl-10 pr-4 py-2 border border-border rounded-r-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Este teléfono se usará para contactarte sobre tu cuenta y soporte
              </p>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end pt-4 border-t border-border">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Guardar Cambios
                </>
              )}
            </button>
          </div>
        </form>

        {/* Account Info */}
        {profile && (
          <div className="mt-8 pt-6 border-t border-border">
            <h3 className="text-lg font-medium text-foreground mb-4">Información de la Cuenta</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Plan Actual</p>
                <p className="font-medium text-foreground capitalize">{profile.plan?.toLowerCase() || 'Free'}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Cuenta Creada</p>
                <p className="font-medium text-foreground">
                  {new Date(profile.createdAt).toLocaleDateString('es-CR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">ID del Negocio</p>
                <p className="font-medium text-foreground font-mono text-xs">{profile.id}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

