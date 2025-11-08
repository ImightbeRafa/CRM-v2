'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import TilopaySubscriptionCheckout from './TilopaySubscriptionCheckout';
import { 
  CreditCard, 
  TrendingUp, 
  Calendar, 
  AlertCircle,
  Check,
  X,
  Download,
  ExternalLink,
  DollarSign,
  Users,
  Package,
  BarChart3,
  Clock
} from 'lucide-react';

interface BillingDashboardProps {
  tenantId?: string;
}

interface Plan {
  id: string;
  name: string;
  price: number;
  interval: 'month' | 'year';
  features: string[];
  limits: {
    users: number;
    orders: number;
    storage: string;
  };
  popular?: boolean;
}

interface CurrentPlan {
  name: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

interface BillingTransaction {
  id: string;
  amount: number;
  currency: string;
  status: string;
  description: string;
  createdAt: string;
}

interface UsageStats {
  users: { current: number; limit: number };
  orders: { current: number; limit: number };
  storage: { current: string; limit: string };
}

export function BillingDashboard({ tenantId }: BillingDashboardProps) {
  const [currentPlan, setCurrentPlan] = useState<CurrentPlan>({
    name: 'FREE',
    status: 'active',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false
  });
  
  const [transactions, setTransactions] = useState<BillingTransaction[]>([]);
  const [usageStats, setUsageStats] = useState<UsageStats>({
    users: { current: 1, limit: 1 },
    orders: { current: 0, limit: 100 },
    storage: { current: '0 MB', limit: '500 MB' }
  });
  
  const [loading, setLoading] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<{id: string, amount: number} | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<{type: 'success' | 'error' | 'cancelled', message: string} | null>(null);
  const [trialStatus, setTrialStatus] = useState<{trialExpired: boolean, daysRemaining: number, isInTrial: boolean, trialEndsAt?: string | null} | null>(null);

  const plans: Plan[] = [
    {
      id: 'free',
      name: 'FREE',
      price: 0,
      interval: 'month',
      features: [
        '1 usuario all access',
        '7 días gratis',
        'Funcionalidades básicas',
        'Soporte por email',
        '500 MB almacenamiento'
      ],
      limits: {
        users: 1,
        orders: 100,
        storage: '500 MB'
      }
    },
    {
      id: 'basic',
      name: 'BASIC',
      price: 20,
      interval: 'month',
      features: [
        '24/7 support',
        'Pedidos ilimitados',
        'Usuarios ilimitados',
        'Todas las funcionalidades',
        'Generador de facturas',
        'Reportes avanzados',
        'Soporte prioritario',
        '5 GB almacenamiento'
      ],
      limits: {
        users: 999999,
        orders: 999999,
        storage: '5 GB'
      },
      popular: true
    },
    {
      id: 'pro',
      name: 'PRO',
      price: 0,
      interval: 'month',
      features: [
        'Próximamente disponible',
        'Funcionalidades avanzadas',
        'Acceso API',
        'Integración TiloPay',
        'Reportes personalizados',
        'Soporte 24/7',
        'Almacenamiento ilimitado',
        'Dominio personalizado'
      ],
      limits: {
        users: 999999,
        orders: 999999,
        storage: 'Ilimitado'
      }
    }
  ];

  useEffect(() => {
    loadBillingData();
    
    // Check for payment status in URL (from Tilopay redirect)
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    
    if (paymentStatus) {
      // Set message based on status
      if (paymentStatus === 'success') {
        setPaymentMessage({
          type: 'success',
          message: '¡Pago procesado exitosamente! Tu plan se está actualizando...'
        });
        // Reload billing data multiple times to ensure it catches the update
        setTimeout(() => loadBillingData(), 2000);
        setTimeout(() => loadBillingData(), 5000);
        setTimeout(() => {
          loadBillingData();
          setTimeout(() => setPaymentMessage(null), 2000);
        }, 8000);
      } else if (paymentStatus === 'error') {
        setPaymentMessage({
          type: 'error',
          message: 'Hubo un error al procesar el pago. Por favor intenta nuevamente.'
        });
      } else if (paymentStatus === 'cancelled') {
        setPaymentMessage({
          type: 'cancelled',
          message: 'Pago cancelado. Puedes intentar nuevamente cuando lo desees.'
        });
      }
      
      // Clean URL (remove payment parameter)
      const cleanUrl = window.location.pathname + '?tab=billing';
      window.history.replaceState({}, '', cleanUrl);
      
      // Auto-hide error/cancelled messages after 10 seconds
      if (paymentStatus === 'error' || paymentStatus === 'cancelled') {
        setTimeout(() => {
          setPaymentMessage(null);
        }, 10000);
      }
    }
  }, []);

  const loadBillingData = async () => {
    try {
      // Load current plan
      const planRes = await fetch('/api/billing/current');
      if (planRes.ok) {
        const planData = await planRes.json();
        if (planData.status === 'success') {
          setCurrentPlan(planData.data);
        }
      }

      // Load billing history
      const historyRes = await fetch('/api/billing/history');
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        if (historyData.status === 'success') {
          setTransactions(historyData.data);
        }
      }

      // Load usage stats
      const usageRes = await fetch('/api/billing/usage');
      if (usageRes.ok) {
        const usageData = await usageRes.json();
        if (usageData.status === 'success') {
          setUsageStats(usageData.data);
        }
      }

      // Load trial status
      const trialRes = await fetch('/api/billing/trial-status');
      if (trialRes.ok) {
        const trialData = await trialRes.json();
        setTrialStatus({
          trialExpired: trialData.trialExpired || false,
          daysRemaining: trialData.daysRemaining || 0,
          isInTrial: trialData.isInTrial || false,
          trialEndsAt: trialData.trialEndsAt || null
        });
      }
    } catch (error) {
      console.error('Error loading billing data:', error);
    }
  };

  const handleChangePlan = async (planId: string) => {
    // Handle Pro plan (Coming Soon)
    if (planId === 'pro') {
      alert('🚀 Pro plan coming soon! We\'ll notify you when it\'s available. For now, try our Basic plan with all the features you need.');
      return;
    }

    if (planId === 'free') {
      if (!confirm('¿Deseas cambiar al plan gratuito? Perderás acceso a funcionalidades premium.')) {
        return;
      }
      
      // Handle free plan downgrade directly
      setLoading(true);
      try {
        const response = await fetch('/api/billing/change-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: 'free' })
        });

        const result = await response.json();
        
        if (result.status === 'success') {
          alert('✅ Plan cambiado a FREE exitosamente');
          await loadBillingData();
        } else {
          alert(`❌ Error: ${result.error}`);
        }
      } catch (error) {
        console.error('Error changing plan:', error);
        alert('❌ Error al cambiar el plan');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Check if user already has this plan or a higher plan
    const currentPlanId = currentPlan.name.toLowerCase();
    const planHierarchy: Record<string, number> = {
      'free': 0,
      'basic': 1,
      'pro': 2
    };

    const currentLevel = planHierarchy[currentPlanId] || 0;
    const targetLevel = planHierarchy[planId] || 0;

    // Prevent duplicate subscriptions to the same plan
    if (currentPlanId === planId && currentPlan.status === 'active') {
      alert('Ya tienes este plan activo. No es necesario suscribirte nuevamente.');
      return;
    }

    // Prevent downgrade through payment link (should use cancel instead)
    if (targetLevel < currentLevel && currentPlan.status === 'active') {
      alert('Para cambiar a un plan menor, primero cancela tu suscripción actual desde la sección de facturación.');
      return;
    }

    // Confirm upgrade from current plan
    if (currentLevel > 0 && targetLevel > currentLevel) {
      const confirmUpgrade = confirm(`¿Deseas actualizar de ${currentPlan.name} a ${planId.toUpperCase()}? Tu suscripción actual se cancelará y se iniciará la nueva.`);
      if (!confirmUpgrade) {
        return;
      }
    }

    // Show important warning about email before redirecting
    const emailWarning = confirm(
      '⚠️ IMPORTANTE: Email para Pago\n\n' +
      'Cuando hagas el pago en TiloPay, DEBES usar el mismo email con el que inicias sesión en BetsyCRM.\n\n' +
      '¿Continuar al pago?'
    );
    
    if (!emailWarning) {
      return; // User canceled
    }
    
    // Show embedded Tilopay SDK v2 checkout
    const planPricing: Record<string, number> = {
      basic: 10000,  // ₡10,000/month ($20 USD)
      pro: 45000     // ₡45,000/month
    };
    
    const amount = planPricing[planId];
    if (amount) {
      setSelectedPlan({ id: planId, amount });
      setShowCheckout(true);
    } else {
      alert('Plan no disponible');
    }
  };

  const handleCancelSubscription = async () => {
    const feedback = prompt('¿Por qué cancelas tu suscripción? (opcional)');
    
    setLoading(true);
    try {
      const response = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback })
      });

      const result = await response.json();
      
      if (result.status === 'success') {
        let message = '✅ Suscripción cancelada. Mantendrás acceso hasta el fin del período actual.';
        if (result.data?.note) {
          message += '\n\n⚠️ ' + result.data.note;
        }
        alert(message);
        await loadBillingData();
        setShowCancelDialog(false);
      } else {
        alert(`❌ Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error canceling subscription:', error);
      alert('❌ Error al cancelar la suscripción');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-CR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      active: { label: 'Activo', variant: 'default' },
      canceled: { label: 'Cancelado', variant: 'destructive' },
      past_due: { label: 'Pago vencido', variant: 'destructive' },
      trialing: { label: 'Prueba', variant: 'secondary' }
    };
    
    const config = statusMap[status] || { label: status, variant: 'outline' };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const currentPlanDetails = plans.find(p => p.id === currentPlan.name.toLowerCase());
  const usagePercentage = {
    users: (usageStats.users.current / usageStats.users.limit) * 100,
    orders: (usageStats.orders.current / usageStats.orders.limit) * 100
  };

  return (
    <div className="space-y-6">
      {/* Trial Expired Banner - Most prominent */}
      {trialStatus?.trialExpired && (
        <Card className="border-red-500 bg-red-50 dark:bg-red-900/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-red-900 dark:text-red-100 mb-2">
                  Tu Período de Prueba ha Expirado
                </h3>
                <p className="text-red-800 dark:text-red-200 mb-4">
                  Tu período de prueba gratuita de 7 días ha finalizado. Para continuar usando todas las funcionalidades de BetsyCRM, 
                  necesitas actualizar a un plan de pago.
                </p>
                <div className="flex gap-3 flex-wrap">
                  <Button
                    onClick={() => handleChangePlan('basic')}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    <CreditCard className="w-4 h-4 mr-2" />
                    Actualizar a Plan Basic ($20/mes)
                  </Button>
                </div>
                <p className="text-sm text-red-700 dark:text-red-300 mt-4">
                  <strong>Nota:</strong> Tu acceso está restringido hasta que actualices tu plan. Solo puedes acceder a esta página de facturación.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment Status Message */}
      {paymentMessage && (
        <Card className={`border-2 ${
          paymentMessage.type === 'success' ? 'border-green-500 bg-green-50' :
          paymentMessage.type === 'error' ? 'border-red-500 bg-red-50' :
          'border-yellow-500 bg-yellow-50'
        }`}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {paymentMessage.type === 'success' ? (
                  <Check className="w-5 h-5 text-green-600" />
                ) : paymentMessage.type === 'error' ? (
                  <X className="w-5 h-5 text-red-600" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-yellow-600" />
                )}
                <p className={`font-medium ${
                  paymentMessage.type === 'success' ? 'text-green-900' :
                  paymentMessage.type === 'error' ? 'text-red-900' :
                  'text-yellow-900'
                }`}>
                  {paymentMessage.type === 'success' ? '✅ ' : paymentMessage.type === 'error' ? '❌ ' : 'ℹ️ '}
                  {paymentMessage.message}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPaymentMessage(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {/* Current Plan Card */}
      <Card>
        <CardHeader className="bg-gradient-to-r from-slate-50 to-gray-100 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl text-gray-900">Plan Actual</CardTitle>
              <CardDescription className="text-gray-600">
                Gestiona tu suscripción y facturación
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Button 
                onClick={loadBillingData}
                variant="outline"
                size="sm"
                className="bg-white hover:bg-gray-50 text-gray-700 border-gray-300"
              >
                🔄 Actualizar
              </Button>
              <div className="p-3 bg-blue-50 rounded-lg">
                <CreditCard className="w-8 h-8 text-blue-600" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Plan Info */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-3xl font-bold text-gray-900">{currentPlan.name}</h3>
                {/* Hide status badge for FREE plan - we show green "Activo" badge below instead */}
                {currentPlan.name !== 'FREE' && getStatusBadge(currentPlan.status)}
              </div>
              
              {currentPlanDetails && (
                <div className="space-y-2">
                  {/* Price display */}
                  <div className="flex items-baseline gap-2">
                    <p className="text-2xl font-bold text-blue-600">
                      {currentPlanDetails.price === 0 
                        ? 'Gratis' 
                        : `${formatCurrency(currentPlanDetails.price)}/mes`
                      }
                    </p>
                    {currentPlan.name === 'FREE' && (
                      <Badge variant="default" className="bg-green-100 text-green-800 border-green-300">
                        Activo
                      </Badge>
                    )}
                  </div>
                  
                  {/* Trial expiration date for FREE plan */}
                  {currentPlan.name === 'FREE' && trialStatus && (
                    <div className="space-y-2">
                      {trialStatus.isInTrial && !trialStatus.trialExpired && (
                        <p className="text-sm text-gray-600">
                          <Calendar className="inline w-4 h-4 mr-1" />
                          Período de prueba expira: {trialStatus.trialEndsAt ? formatDate(trialStatus.trialEndsAt) : 'N/A'}
                        </p>
                      )}
                      {trialStatus.trialExpired && (
                        <p className="text-sm text-red-600 font-medium">
                          <AlertCircle className="inline w-4 h-4 mr-1" />
                          Período de prueba expirado
                        </p>
                      )}
                      {trialStatus.daysRemaining > 0 && trialStatus.daysRemaining <= 7 && (
                        <p className="text-sm text-orange-600">
                          <Clock className="inline w-4 h-4 mr-1" />
                          {trialStatus.daysRemaining === 1 
                            ? '¡Último día de prueba!' 
                            : `${trialStatus.daysRemaining} días restantes de prueba gratuita`
                          }
                        </p>
                      )}
                    </div>
                  )}
                  
                  {/* Billing period for paid plans */}
                  {currentPlan.currentPeriodEnd && currentPlan.name !== 'FREE' && (
                    <p className="text-sm text-gray-600">
                      <Calendar className="inline w-4 h-4 mr-1" />
                      {currentPlan.cancelAtPeriodEnd 
                        ? `Termina el ${formatDate(currentPlan.currentPeriodEnd)}`
                        : `Próxima renovación: ${formatDate(currentPlan.currentPeriodEnd)}`
                      }
                    </p>
                  )}
                  
                  {!currentPlan.currentPeriodEnd && currentPlan.name !== 'FREE' && (
                    <p className="text-sm text-gray-600">
                      <Calendar className="inline w-4 h-4 mr-1" />
                      Próxima renovación: Calculando...
                    </p>
                  )}
                  
                  {currentPlan.cancelAtPeriodEnd && (
                    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-sm text-yellow-800">
                        <AlertCircle className="inline w-4 h-4 mr-1" />
                        Tu suscripción se cancelará al final del período actual
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Usage Stats */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-900">Uso del Plan</h4>
              
              {/* Users */}
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">
                    <Users className="inline w-4 h-4 mr-1" />
                    Usuarios
                  </span>
                  <span className="font-medium">
                    {usageStats.users.current} / {usageStats.users.limit}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className={`h-2 rounded-full ${
                      usagePercentage.users >= 90 ? 'bg-red-500' :
                      usagePercentage.users >= 70 ? 'bg-yellow-500' :
                      'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(usagePercentage.users, 100)}%` }}
                  />
                </div>
              </div>

              {/* Orders */}
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">
                    <Package className="inline w-4 h-4 mr-1" />
                    Órdenes este mes
                  </span>
                  <span className="font-medium">
                    {usageStats.orders.current} / {usageStats.orders.limit}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className={`h-2 rounded-full ${
                      usagePercentage.orders >= 90 ? 'bg-red-500' :
                      usagePercentage.orders >= 70 ? 'bg-yellow-500' :
                      'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(usagePercentage.orders, 100)}%` }}
                  />
                </div>
              </div>

              {/* Storage */}
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">
                    <BarChart3 className="inline w-4 h-4 mr-1" />
                    Almacenamiento
                  </span>
                  <span className="font-medium">
                    {usageStats.storage.current} / {usageStats.storage.limit}
                  </span>
                </div>
              </div>

              {(usagePercentage.users >= 80 || usagePercentage.orders >= 80) && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <p className="text-sm text-orange-800">
                    <AlertCircle className="inline w-4 h-4 mr-1" />
                    Te estás acercando al límite. Considera actualizar tu plan.
                  </p>
                  <Button 
                    size="sm" 
                    className="mt-2 w-full"
                    onClick={() => document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' })}
                  >
                    Ver Planes
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Important Disclaimer for TiloPay */}
      <Card className="border-2 border-yellow-400 bg-yellow-50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-yellow-900 mb-2">
                ⚠️ Importante: Email para Pagos de TiloPay
              </h3>
              <p className="text-sm text-yellow-800 mb-2">
                Cuando hagas el pago en TiloPay, <strong>debes usar el mismo email de tu cuenta de BetsyCRM</strong>.
              </p>
              
              <p className="text-xs text-yellow-700 font-medium mt-3">
                ✓ Usa el email con el que inicias sesión en BetsyCRM<br/>
                ✗ No uses un email diferente al hacer el pago
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Available Plans */}
      <div id="plans">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Planes Disponibles</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan) => (
            <Card 
              key={plan.id}
              className={`relative ${
                plan.popular ? 'border-2 border-blue-500 shadow-lg' : ''
              } ${
                plan.id === currentPlan.name.toLowerCase() ? 'ring-2 ring-green-500' : ''
              }`}
            >
              {plan.id === currentPlan.name.toLowerCase() ? (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <Badge className="bg-green-500 text-white shadow-lg">
                    <Check className="w-3 h-3 mr-1" />
                    Plan Actual
                  </Badge>
                </div>
              ) : plan.popular ? (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <Badge className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg">
                    ✨ Todo lo que Necesitas
                  </Badge>
                </div>
              ) : null}

              <CardHeader>
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <div className="text-3xl font-bold text-blue-600">
                  {plan.id === 'enterprise' 
                    ? 'Contactar' 
                    : plan.price === 0 
                      ? 'Gratis' 
                      : `${formatCurrency(plan.price)}`
                  }
                </div>
                {plan.price > 0 && plan.id !== 'enterprise' && (
                  <p className="text-sm text-gray-500">por mes</p>
                )}
              </CardHeader>

              <CardContent>
                <ul className="space-y-2 mb-6">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-start text-sm">
                      <Check className="w-4 h-4 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  className="w-full"
                  variant={plan.id === currentPlan.name.toLowerCase() ? 'outline' : 'default'}
                  disabled={plan.id === currentPlan.name.toLowerCase() || loading}
                  onClick={() => handleChangePlan(plan.id)}
                >
                  {plan.id === currentPlan.name.toLowerCase() 
                    ? 'Plan Actual'
                    : plan.id === 'pro'
                      ? 'Próximamente'
                      : plan.price === 0
                        ? 'Cambiar a Gratis'
                        : 'Actualizar Plan'
                  }
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Billing History */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de Facturación</CardTitle>
          <CardDescription>
            Todas tus transacciones y pagos
          </CardDescription>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <DollarSign className="w-12 h-12 mx-auto mb-2 text-gray-400" />
              <p>No hay transacciones aún</p>
            </div>
          ) : (
            <div className="space-y-3">
              {transactions.map((transaction) => (
                <div 
                  key={transaction.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${
                      transaction.status === 'success' ? 'bg-green-100' :
                      transaction.status === 'pending' ? 'bg-yellow-100' :
                      'bg-red-100'
                    }`}>
                      <DollarSign className={`w-5 h-5 ${
                        transaction.status === 'success' ? 'text-green-600' :
                        transaction.status === 'pending' ? 'text-yellow-600' :
                        'text-red-600'
                      }`} />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">
                        {transaction.description}
                      </div>
                      <div className="text-sm text-gray-500">
                        {formatDate(transaction.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="font-semibold text-gray-900">
                        {formatCurrency(transaction.amount, transaction.currency)}
                      </div>
                      <Badge variant={
                        transaction.status === 'success' ? 'default' :
                        transaction.status === 'pending' ? 'secondary' :
                        'destructive'
                      }>
                        {transaction.status === 'success' ? 'Pagado' :
                         transaction.status === 'pending' ? 'Pendiente' :
                         transaction.status === 'refunded' ? 'Reembolsado' :
                         'Fallido'}
                      </Badge>
                    </div>
                    <Button variant="ghost" size="sm">
                      <Download className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancel Subscription */}
      {currentPlan.name !== 'FREE' && !currentPlan.cancelAtPeriodEnd && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-red-600">Zona de Peligro</CardTitle>
            <CardDescription>
              Acciones irreversibles para tu cuenta
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold text-gray-900 mb-1">
                  Cancelar Suscripción
                </h4>
                <p className="text-sm text-gray-600">
                  Cancela tu plan actual. Mantendrás acceso hasta el fin del período.
                </p>
              </div>
              <Button 
                variant="destructive"
                onClick={() => setShowCancelDialog(true)}
                disabled={loading}
              >
                Cancelar Plan
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cancel Confirmation Dialog */}
      {showCancelDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-md w-full">
            <CardHeader>
              <CardTitle className="text-red-600">
                <AlertCircle className="inline w-6 h-6 mr-2" />
                ¿Cancelar Suscripción?
              </CardTitle>
              <CardDescription>
                Esta acción cancelará tu suscripción al final del período actual
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  <strong>Nota:</strong> Mantendrás acceso completo hasta el {' '}
                  {currentPlan.currentPeriodEnd && formatDate(currentPlan.currentPeriodEnd)}
                </p>
              </div>
              
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowCancelDialog(false)}
                >
                  <X className="w-4 h-4 mr-2" />
                  Mantener Plan
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={handleCancelSubscription}
                  disabled={loading}
                >
                  {loading ? 'Cancelando...' : 'Confirmar Cancelación'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tilopay SDK v2 Checkout Modal */}
      {showCheckout && selectedPlan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="relative max-w-md w-full">
            <TilopaySubscriptionCheckout
              planId={selectedPlan.id}
              planName={selectedPlan.id.toUpperCase()}
              amount={selectedPlan.amount / 1000} // Convert CRC to USD approximation
              onSuccess={() => {
                setShowCheckout(false);
                setSelectedPlan(null);
                loadBillingData();
                setPaymentMessage({
                  type: 'success',
                  message: '¡Suscripción activada exitosamente! Tu tarjeta será cargada mensualmente.'
                });
              }}
              onError={(error) => {
                setPaymentMessage({ 
                  type: 'error', 
                  message: error || 'Error al procesar el pago. Intenta nuevamente.'
                });
              }}
              onClose={() => {
                setShowCheckout(false);
                setSelectedPlan(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

