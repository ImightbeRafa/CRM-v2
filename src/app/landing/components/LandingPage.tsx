'use client';

import { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { 
  CheckCircle, 
  Star, 
  TrendingUp, 
  Package, 
  Clock, 
  BarChart3, 
  Users, 
  Bell,
  ArrowRight,
  Menu,
  X,
  Twitter,
  Linkedin,
  Mail,
  Eye,
  Target,
  DollarSign
} from 'lucide-react';
import SimplePricingSection from './SimplePricingSection';
import SimpleAuthModal from './SimpleAuthModal';

export default function LandingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const features = [
    {
      icon: <TrendingUp className="h-6 w-6" />,
      title: "Increase Your Sales",
      description: "Track every opportunity from first contact to closed deal. Never let a potential sale slip through the cracks."
    },
    {
      icon: <Package className="h-6 w-6" />,
      title: "Manage All Your Orders",
      description: "Keep every order organized in one place. See status, track progress, and deliver on time, every time."
    },
    {
      icon: <Clock className="h-6 w-6" />,
      title: "Save Hours Every Week",
      description: "Automate repetitive tasks and focus on what matters - growing your business and serving customers."
    },
    {
      icon: <BarChart3 className="h-6 w-6" />,
      title: "Know Your Numbers",
      description: "See exactly how your business is performing with clear, easy-to-understand reports and charts."
    },
    {
      icon: <Users className="h-6 w-6" />,
      title: "Keep Your Team Aligned",
      description: "Everyone sees the same information. No more confusion about order status or customer details."
    },
    {
      icon: <Bell className="h-6 w-6" />,
      title: "Never Miss a Follow-Up",
      description: "Get reminders for important tasks and follow-ups so you can provide excellent customer service."
    }
  ];


  const testimonials = [
    {
      name: "María González",
      role: "Owner, Boutique Luna",
      content: "Since using Betsy, I've increased my sales by 40%. I can finally see all my orders in one place and know exactly what needs to be done each day.",
      rating: 5
    },
    {
      name: "Carlos Ramírez",
      role: "Sales Manager, Distribuidora CR",
      content: "We used to lose orders in WhatsApp and emails. Now everything is organized and my team knows exactly what each customer needs.",
      rating: 5
    },
    {
      name: "Ana Jiménez",
      role: "E-commerce Manager",
      content: "The visual order board changed everything! I can drag and drop orders through different stages. It's so simple but powerful.",
      rating: 5
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-gray-200 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <h1 className="text-2xl font-bold text-blue-600">Betsy CRM</h1>
              </div>
            </div>
            
            <div className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-4">
                <a href="#features" className="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium">Features</a>
                <a href="#pricing" className="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium">Pricing</a>
                <a href="#about" className="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium">About</a>
                <a href="#contact" className="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium">Contact</a>
              </div>
            </div>

            <div className="hidden md:block">
              <div className="ml-4 flex items-center space-x-4">
                <Button variant="outline" size="sm" onClick={() => setIsAuthModalOpen(true)}>
                  Sign In
                </Button>
                <Button size="sm" onClick={() => setIsAuthModalOpen(true)}>
                  Get Started
                </Button>
              </div>
            </div>

            <div className="md:hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
              >
                {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {isMenuOpen && (
          <div className="md:hidden">
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-white border-t">
              <a href="#features" className="text-gray-700 hover:text-blue-600 block px-3 py-2 rounded-md text-base font-medium">Features</a>
              <a href="#pricing" className="text-gray-700 hover:text-blue-600 block px-3 py-2 rounded-md text-base font-medium">Pricing</a>
              <a href="#about" className="text-gray-700 hover:text-blue-600 block px-3 py-2 rounded-md text-base font-medium">About</a>
              <a href="#contact" className="text-gray-700 hover:text-blue-600 block px-3 py-2 rounded-md text-base font-medium">Contact</a>
              <div className="pt-4 pb-3 border-t border-gray-200">
                <div className="flex items-center px-3">
                  <Button variant="outline" size="sm" className="w-full mr-2">
                    Sign In
                  </Button>
                  <Button size="sm" className="w-full">
                    Get Started
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="pt-20 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <Badge variant="secondary" className="mb-4">
              📈 Join hundreds of businesses growing with Betsy
            </Badge>
            <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
              Sell More. Stay Organized.
              <span className="text-blue-600"> Grow Faster.</span>
            </h1>
            <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
              The simple order management system that helps you keep track of every sale, 
              follow up with customers, and never miss an opportunity.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" className="text-lg px-8 py-3" onClick={() => setIsAuthModalOpen(true)}>
                Start Free Trial
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button variant="outline" size="lg" className="text-lg px-8 py-3">
                See How It Works
              </Button>
            </div>
            <p className="text-sm text-gray-500 mt-4">
              No credit card required • Setup in 5 minutes • Cancel anytime
            </p>
          </div>
        </div>
      </section>

      {/* Screenshot Preview Section */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-blue-600 to-purple-600">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              See Your Business at a Glance
            </h2>
            <p className="text-xl text-blue-100 max-w-3xl mx-auto">
              Everything you need to manage orders and grow sales in one beautiful dashboard
            </p>
          </div>
          
          {/* Main Dashboard Preview */}
          <div className="bg-white rounded-xl shadow-2xl overflow-hidden border-4 border-white/20">
            <div className="bg-gray-100 px-4 py-3 flex items-center space-x-2 border-b">
              <div className="flex space-x-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
              </div>
              <div className="flex-1 text-center text-sm text-gray-600">
                dashboard.betsy.com
              </div>
            </div>
            <div className="p-8 bg-gradient-to-br from-gray-50 to-gray-100">
              <div className="space-y-6">
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">Total Orders</span>
                      <TrendingUp className="h-5 w-5 text-green-600" />
                    </div>
                    <p className="text-3xl font-bold text-gray-900">247</p>
                    <p className="text-sm text-green-600 mt-1">↑ 23% this month</p>
                  </div>
                  <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">Revenue</span>
                      <DollarSign className="h-5 w-5 text-blue-600" />
                    </div>
                    <p className="text-3xl font-bold text-gray-900">$48,392</p>
                    <p className="text-sm text-blue-600 mt-1">↑ 18% this month</p>
                  </div>
                  <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">Active Orders</span>
                      <Package className="h-5 w-5 text-orange-600" />
                    </div>
                    <p className="text-3xl font-bold text-gray-900">34</p>
                    <p className="text-sm text-orange-600 mt-1">In progress</p>
                  </div>
                </div>
                
                {/* Kanban Preview */}
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Visual Order Board</h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-gray-700 mb-2">New Orders</div>
                      <div className="bg-blue-50 border-l-4 border-blue-500 p-3 rounded text-sm">
                        <p className="font-medium text-gray-900">Order #1234</p>
                        <p className="text-gray-600 text-xs mt-1">Customer: María S.</p>
                      </div>
                      <div className="bg-blue-50 border-l-4 border-blue-500 p-3 rounded text-sm">
                        <p className="font-medium text-gray-900">Order #1235</p>
                        <p className="text-gray-600 text-xs mt-1">Customer: Juan P.</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-gray-700 mb-2">Processing</div>
                      <div className="bg-yellow-50 border-l-4 border-yellow-500 p-3 rounded text-sm">
                        <p className="font-medium text-gray-900">Order #1230</p>
                        <p className="text-gray-600 text-xs mt-1">Customer: Ana G.</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-gray-700 mb-2">Shipping</div>
                      <div className="bg-purple-50 border-l-4 border-purple-500 p-3 rounded text-sm">
                        <p className="font-medium text-gray-900">Order #1228</p>
                        <p className="text-gray-600 text-xs mt-1">Customer: Carlos R.</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-gray-700 mb-2">Delivered</div>
                      <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded text-sm">
                        <p className="font-medium text-gray-900">Order #1225</p>
                        <p className="text-gray-600 text-xs mt-1">Customer: Sofia M.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="text-center mt-8">
            <p className="text-blue-100 text-lg">
              <Eye className="inline h-5 w-5 mr-2" />
              Drag and drop orders • Track progress • See everything at once
            </p>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-16 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Everything You Need to Grow Your Business
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Simple, powerful tools that help you sell more and stay organized
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <Card key={index} className="border-0 shadow-lg hover:shadow-xl transition-shadow">
                <CardHeader>
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                      {feature.icon}
                    </div>
                    <CardTitle className="text-xl">{feature.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-gray-600">
                    {feature.description}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              See How Betsy Helps Your Business
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              From first contact to delivered order - manage everything in one place
            </p>
          </div>

          <div className="space-y-16">
            {/* Use Case 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div>
                <Badge variant="secondary" className="mb-4">📱 Track Every Lead</Badge>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">
                  Never Lose a Potential Customer Again
                </h3>
                <p className="text-lg text-gray-600 mb-6">
                  Customer messaged you on WhatsApp? Add them to Betsy in seconds. See their complete 
                  history: what they ordered, when they last bought, and what they're interested in.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-600 mr-3 flex-shrink-0 mt-1" />
                    <span className="text-gray-700">Add customers from any channel (WhatsApp, Instagram, phone calls)</span>
                  </li>
                  <li className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-600 mr-3 flex-shrink-0 mt-1" />
                    <span className="text-gray-700">See complete purchase history at a glance</span>
                  </li>
                  <li className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-600 mr-3 flex-shrink-0 mt-1" />
                    <span className="text-gray-700">Set reminders to follow up at the perfect time</span>
                  </li>
                </ul>
              </div>
              <div className="bg-white rounded-xl shadow-2xl p-6 border-2 border-gray-200">
                <div className="space-y-4">
                  <div className="border-b pb-3">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Customer Details</h4>
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Name</p>
                      <p className="font-semibold text-gray-900 mb-3">María González</p>
                      <p className="text-sm text-gray-600 mb-1">Contact</p>
                      <p className="font-semibold text-gray-900 mb-3">+506 8888-9999</p>
                      <p className="text-sm text-gray-600 mb-1">Total Orders</p>
                      <p className="font-semibold text-blue-600">12 orders • $2,450 total</p>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">Recent Orders</h4>
                    <div className="space-y-2">
                      <div className="bg-gray-50 p-3 rounded">
                        <p className="text-sm font-medium text-gray-900">#1234 - Red Dress Size M</p>
                        <p className="text-xs text-gray-600">Delivered 2 weeks ago</p>
                      </div>
                      <div className="bg-gray-50 p-3 rounded">
                        <p className="text-sm font-medium text-gray-900">#1189 - Blue Shoes Size 7</p>
                        <p className="text-xs text-gray-600">Delivered 1 month ago</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Use Case 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div className="lg:order-2">
                <Badge variant="secondary" className="mb-4">📊 Track Progress</Badge>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">
                  See Exactly Where Every Order Stands
                </h3>
                <p className="text-lg text-gray-600 mb-6">
                  No more digging through messages trying to remember order status. With Betsy's visual board, 
                  you can see and update every order's status with a simple drag and drop.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-600 mr-3 flex-shrink-0 mt-1" />
                    <span className="text-gray-700">Drag orders from "New" to "Processing" to "Shipped" to "Delivered"</span>
                  </li>
                  <li className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-600 mr-3 flex-shrink-0 mt-1" />
                    <span className="text-gray-700">Your team sees updates in real-time</span>
                  </li>
                  <li className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-600 mr-3 flex-shrink-0 mt-1" />
                    <span className="text-gray-700">Customers get automatic status updates</span>
                  </li>
                </ul>
              </div>
              <div className="lg:order-1 bg-white rounded-xl shadow-2xl p-6 border-2 border-gray-200">
                <h4 className="text-sm font-semibold text-gray-700 mb-4">Order Status Board</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 p-3 rounded-lg border-l-4 border-blue-500">
                    <p className="text-xs font-semibold text-gray-700 mb-2">NEW (5)</p>
                    <div className="space-y-2">
                      <div className="bg-white p-2 rounded shadow-sm text-xs">
                        <p className="font-medium">#1240</p>
                        <p className="text-gray-600">Ana M.</p>
                      </div>
                      <div className="bg-white p-2 rounded shadow-sm text-xs">
                        <p className="font-medium">#1241</p>
                        <p className="text-gray-600">Carlos R.</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-yellow-50 p-3 rounded-lg border-l-4 border-yellow-500">
                    <p className="text-xs font-semibold text-gray-700 mb-2">PROCESSING (3)</p>
                    <div className="space-y-2">
                      <div className="bg-white p-2 rounded shadow-sm text-xs">
                        <p className="font-medium">#1238</p>
                        <p className="text-gray-600">María G.</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-purple-50 p-3 rounded-lg border-l-4 border-purple-500">
                    <p className="text-xs font-semibold text-gray-700 mb-2">SHIPPED (2)</p>
                    <div className="space-y-2">
                      <div className="bg-white p-2 rounded shadow-sm text-xs">
                        <p className="font-medium">#1236</p>
                        <p className="text-gray-600">Juan P.</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-green-50 p-3 rounded-lg border-l-4 border-green-500">
                    <p className="text-xs font-semibold text-gray-700 mb-2">DELIVERED (8)</p>
                    <div className="space-y-2">
                      <div className="bg-white p-2 rounded shadow-sm text-xs">
                        <p className="font-medium">#1235</p>
                        <p className="text-gray-600">Sofia M.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Use Case 3 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div>
                <Badge variant="secondary" className="mb-4">💰 Understand Your Business</Badge>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">
                  Know What's Working (And What's Not)
                </h3>
                <p className="text-lg text-gray-600 mb-6">
                  Finally see your numbers clearly. Which products sell best? Which days are busiest? 
                  How much revenue did you make this month? Get answers in seconds, not hours.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-600 mr-3 flex-shrink-0 mt-1" />
                    <span className="text-gray-700">See revenue, orders, and growth trends</span>
                  </li>
                  <li className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-600 mr-3 flex-shrink-0 mt-1" />
                    <span className="text-gray-700">Know which products are your top sellers</span>
                  </li>
                  <li className="flex items-start">
                    <CheckCircle className="h-6 w-6 text-green-600 mr-3 flex-shrink-0 mt-1" />
                    <span className="text-gray-700">Export reports for your accountant with one click</span>
                  </li>
                </ul>
              </div>
              <div className="bg-white rounded-xl shadow-2xl p-6 border-2 border-gray-200">
                <h4 className="text-sm font-semibold text-gray-700 mb-4">Sales Dashboard</h4>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-4 rounded-lg text-white">
                      <p className="text-xs mb-1">This Month</p>
                      <p className="text-2xl font-bold">$12,450</p>
                      <p className="text-xs mt-1">↑ 23% vs last month</p>
                    </div>
                    <div className="bg-gradient-to-br from-green-500 to-green-600 p-4 rounded-lg text-white">
                      <p className="text-xs mb-1">Orders</p>
                      <p className="text-2xl font-bold">87</p>
                      <p className="text-xs mt-1">↑ 18% vs last month</p>
                    </div>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-xs font-semibold text-gray-700 mb-3">Top Products</p>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-700">Summer Dress</span>
                        <span className="text-sm font-semibold text-gray-900">$2,340</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-700">Leather Wallet</span>
                        <span className="text-sm font-semibold text-gray-900">$1,890</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-700">Canvas Bag</span>
                        <span className="text-sm font-semibold text-gray-900">$1,550</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

            {/* Pricing Section */}
            <SimplePricingSection />

      {/* Testimonials Section */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Trusted by Growing Businesses
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              See what our customers have to say about Betsy CRM
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <Card key={index} className="border-0 shadow-lg">
                <CardContent className="pt-6">
                  <div className="flex items-center mb-4">
                    {[...Array(testimonial.rating)].map((_, i) => (
                      <Star key={i} className="h-5 w-5 text-yellow-400 fill-current" />
                    ))}
                  </div>
                  <p className="text-gray-700 mb-4">&ldquo;{testimonial.content}&rdquo;</p>
                  <div>
                    <p className="font-semibold text-gray-900">{testimonial.name}</p>
                    <p className="text-sm text-gray-600">{testimonial.role}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Helps Section */}
      <section id="about" className="py-16 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <Badge variant="secondary" className="mb-4">Real Results</Badge>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
                Stop Losing Orders. Start Growing.
              </h2>
              <p className="text-lg text-gray-600 mb-6">
                Are you tired of tracking orders in WhatsApp, Excel, and sticky notes? 
                Missing follow-ups because things slip through the cracks? Spending hours 
                trying to figure out what needs to be done today?
              </p>
              <p className="text-lg text-gray-600 mb-6">
                <strong className="text-gray-900">Betsy gives you one place for everything.</strong> See all 
                your orders, know exactly what stage each one is in, and get automatic reminders 
                so you never miss a follow-up.
              </p>
              <p className="text-lg text-gray-600 mb-8">
                Our customers report <strong className="text-blue-600">40% more sales</strong> within 
                the first 3 months just from staying organized and not losing opportunities.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" onClick={() => setIsAuthModalOpen(true)}>
                  Try It Free
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button variant="outline" size="lg">
                  See Case Studies
                </Button>
              </div>
            </div>
            <div className="bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl p-8 text-white">
              <h3 className="text-2xl font-bold mb-6">What You Get:</h3>
              <ul className="space-y-4">
                <li className="flex items-start">
                  <CheckCircle className="h-6 w-6 mr-3 flex-shrink-0 mt-1" />
                  <div>
                    <strong className="block">Visual Order Board</strong>
                    <span className="text-blue-100">Drag and drop orders through stages - from "New" to "Delivered"</span>
                  </div>
                </li>
                <li className="flex items-start">
                  <CheckCircle className="h-6 w-6 mr-3 flex-shrink-0 mt-1" />
                  <div>
                    <strong className="block">Customer History</strong>
                    <span className="text-blue-100">See every order, note, and interaction with each customer</span>
                  </div>
                </li>
                <li className="flex items-start">
                  <CheckCircle className="h-6 w-6 mr-3 flex-shrink-0 mt-1" />
                  <div>
                    <strong className="block">Sales Reports</strong>
                    <span className="text-blue-100">Know your numbers: revenue, best products, busiest days</span>
                  </div>
                </li>
                <li className="flex items-start">
                  <CheckCircle className="h-6 w-6 mr-3 flex-shrink-0 mt-1" />
                  <div>
                    <strong className="block">Team Collaboration</strong>
                    <span className="text-blue-100">Your whole team sees the same information, no confusion</span>
                  </div>
                </li>
                <li className="flex items-start">
                  <CheckCircle className="h-6 w-6 mr-3 flex-shrink-0 mt-1" />
                  <div>
                    <strong className="block">Automatic Reminders</strong>
                    <span className="text-blue-100">Never forget to follow up with a customer again</span>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof Section */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Real People. Real Results.
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Here's what happens when you stop losing orders and start staying organized
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            <Card className="border-0 shadow-lg text-center">
              <CardContent className="pt-8">
                <div className="text-5xl font-bold text-blue-600 mb-2">40%</div>
                <p className="text-gray-600 text-lg">Average sales increase in first 3 months</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-lg text-center">
              <CardContent className="pt-8">
                <div className="text-5xl font-bold text-green-600 mb-2">5hrs</div>
                <p className="text-gray-600 text-lg">Saved per week on admin tasks</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-lg text-center">
              <CardContent className="pt-8">
                <div className="text-5xl font-bold text-purple-600 mb-2">0</div>
                <p className="text-gray-600 text-lg">Lost orders due to disorganization</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-blue-600 to-purple-600">
        <div className="max-w-7xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Ready to Sell More and Stay Organized?
          </h2>
          <p className="text-xl text-blue-100 mb-8 max-w-3xl mx-auto">
            Join hundreds of businesses already growing with Betsy. 
            Get started in 5 minutes - no credit card required.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6">
            <Button size="lg" variant="secondary" className="text-lg px-8 py-3" onClick={() => setIsAuthModalOpen(true)}>
              Start Free Trial
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 py-3 text-white border-white hover:bg-white hover:text-blue-600">
              Schedule a Demo
            </Button>
          </div>
          <p className="text-blue-100 text-sm">
            ✓ Free 14-day trial &nbsp;&nbsp; ✓ No credit card needed &nbsp;&nbsp; ✓ Cancel anytime &nbsp;&nbsp; ✓ Setup in 5 minutes
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer id="contact" className="bg-gray-900 text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <h3 className="text-2xl font-bold mb-4">Betsy</h3>
              <p className="text-gray-400 mb-4">
                Simple order management that helps you sell more and stay organized.
              </p>
              <div className="flex space-x-4">
                <a href="#" className="text-gray-400 hover:text-white">
                  <Twitter className="h-6 w-6" />
                </a>
                <a href="#" className="text-gray-400 hover:text-white">
                  <Linkedin className="h-6 w-6" />
                </a>
                <a href="#" className="text-gray-400 hover:text-white">
                  <Mail className="h-6 w-6" />
                </a>
              </div>
            </div>
            <div>
              <h4 className="text-lg font-semibold mb-4">Product</h4>
              <ul className="space-y-2">
                <li><a href="#features" className="text-gray-400 hover:text-white">Features</a></li>
                <li><a href="#pricing" className="text-gray-400 hover:text-white">Pricing</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white">How It Works</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white">Case Studies</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-lg font-semibold mb-4">Resources</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-400 hover:text-white">Getting Started</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white">Video Tutorials</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white">FAQ</a></li>
                <li><a href="#contact" className="text-gray-400 hover:text-white">Contact Us</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-lg font-semibold mb-4">Legal</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-400 hover:text-white">Terms of Service</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white">Privacy Policy</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white">Security</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white">GDPR</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-12 pt-8 text-center">
            <p className="text-gray-400">
              © 2025 Betsy. All rights reserved. Made with ❤️ for growing businesses.
            </p>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      <SimpleAuthModal 
        isOpen={isAuthModalOpen} 
        onClose={() => setIsAuthModalOpen(false)} 
      />
    </div>
  );
}
