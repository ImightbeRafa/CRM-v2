'use client';

import { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { CheckCircle, Loader2 } from 'lucide-react';

const pricingPlans = [
  {
    name: "Free",
    price: "$0",
    period: "/month",
    description: "Perfect for small teams getting started",
    features: [
      "Up to 5 users",
      "Basic CRM features",
      "Email support",
      "1GB storage",
      "Basic reporting"
    ],
    cta: "Get Started Free",
    popular: false,
    priceId: null, // Free plan
    stripePriceId: null
  },
  {
    name: "Pro",
    price: "$29",
    period: "/month",
    description: "Ideal for growing businesses",
    features: [
      "Up to 50 users",
      "Advanced CRM features",
      "Priority support",
      "10GB storage",
      "Advanced analytics",
      "API access",
      "Custom fields"
    ],
    cta: "Start Pro Trial",
    popular: true,
    priceId: "pro",
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID
  },
  {
    name: "Enterprise",
    price: "$99",
    period: "/month",
    description: "For large organizations",
    features: [
      "Unlimited users",
      "All Pro features",
      "24/7 phone support",
      "Unlimited storage",
      "Custom integrations",
      "SSO authentication",
      "Dedicated account manager"
    ],
    cta: "Contact Sales",
    popular: false,
    priceId: "enterprise",
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID
  }
];

export default function SimplePricingSection() {
  const [loading, setLoading] = useState<string | null>(null);

  const handlePlanSelect = async (plan: typeof pricingPlans[0]) => {
    if (plan.priceId === null) {
      // Free plan - redirect to sign up with plan param
      window.location.href = '/auth/signin?plan=free';
      return;
    }

    if (plan.priceId === 'enterprise') {
      // Enterprise plan - redirect to contact
      window.location.href = '/contact?plan=enterprise';
      return;
    }

    // For paid plans, show loading and redirect to auth with plan param
    setLoading(plan.priceId);
    setTimeout(() => {
      window.location.href = `/auth/signin?plan=${encodeURIComponent(plan.priceId || '')}`;
    }, 1000);
  };

  return (
    <section id="pricing" className="py-16 px-4 sm:px-6 lg:px-8 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Choose the plan that fits your business. All plans include our core features.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {pricingPlans.map((plan, index) => (
            <Card key={index} className={`relative ${plan.popular ? 'border-blue-500 shadow-xl' : 'border-gray-200'}`}>
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                  <Badge className="bg-blue-500 text-white">Most Popular</Badge>
                </div>
              )}
              <CardHeader className="text-center">
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <div className="mt-4">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-gray-600">{plan.period}</span>
                </div>
                <CardDescription className="mt-2">{plan.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {plan.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-center">
                      <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button 
                  className={`w-full mt-6 ${plan.popular ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                  variant={plan.popular ? 'default' : 'outline'}
                  onClick={() => handlePlanSelect(plan)}
                  disabled={loading === plan.priceId}
                >
                  {loading === plan.priceId ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    plan.cta
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-gray-600 mb-4">
            All plans include 14-day free trial. No credit card required.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="outline">
              View All Features
            </Button>
            <Button variant="outline">
              Compare Plans
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
