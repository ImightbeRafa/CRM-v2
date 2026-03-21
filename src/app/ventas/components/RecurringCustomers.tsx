import React, { useState, useEffect } from 'react';
import { Users, Search, Clock, Star, TrendingUp } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { CustomerSuggestion } from './types';

interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string;
  province: string;
  canton: string;
  district: string;
  address?: string;
  business?: string;
  username?: string;
  totalOrders: number;
  totalSpent: number;
  lastOrder: string;
  isActive: boolean;
  isFavorite: boolean;
}

interface RecurringCustomersProps {
  onCustomerSelect: (customer: CustomerSuggestion) => void;
  currentCustomerName?: string;
}

const RecurringCustomers: React.FC<RecurringCustomersProps> = ({
  onCustomerSelect,
  currentCustomerName
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [automaticClients, setAutomaticClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Load automatic clients from API
  useEffect(() => {
    const loadClients = async () => {
      setLoading(true);
      try {
        const clientsRes = await fetch('/api/config/automatic-clients', { credentials: 'include' });
        const data = await clientsRes.json();

        if (data.status === 'success') {
          setAutomaticClients(data.data);
        }
      } catch (error) {
        console.error('Error loading clients:', error);
      } finally {
        setLoading(false);
      }
    };

    loadClients();
  }, []);

  // Sync automatic clients from orders
  const handleSyncClients = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/config/automatic-clients/sync', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        // Reload clients after sync
        const clientsRes = await fetch('/api/config/automatic-clients', { credentials: 'include' });
        const clientsData = await clientsRes.json();
        if (clientsData.status === 'success') {
          setAutomaticClients(clientsData.data);
        }
      }
    } catch (error) {
      console.error('Error syncing clients:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter clients based on search term
  const filteredClients = automaticClients.filter(client =>
    client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.phone.includes(searchTerm) ||
    (client.email && client.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Get top clients (favorites + most orders)
  const topClients = filteredClients
    .sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return b.totalOrders - a.totalOrders;
    })
    .slice(0, 5);

  const handleSelectClient = (client: Client) => {
    const customerSuggestion: CustomerSuggestion = {
      id: client.id,
      name: client.name,
      phone: client.phone,
      email: client.email || '',
      province: client.province,
      canton: client.canton,
      district: client.district,
      address: client.address || '',
      business: client.business || '',
      totalOrders: client.totalOrders,
      totalSpent: client.totalSpent,
      lastOrder: new Date(client.lastOrder)
    };
    onCustomerSelect(customerSuggestion);
    setSearchTerm('');
    setShowDropdown(false);
  };

  return (
    <div className="space-y-3 mb-4 p-4 bg-purple-50 dark:bg-purple-950/20 rounded-lg border border-purple-200 dark:border-purple-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-purple-600" />
          <h4 className="font-semibold text-purple-800 dark:text-purple-300">Clientes Recurrentes</h4>
        </div>
        <Button
          type="button"
          onClick={handleSyncClients}
          disabled={loading}
          size="sm"
          variant="outline"
          className="text-xs"
        >
          {loading ? 'Sincronizando...' : 'Sincronizar'}
        </Button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setShowDropdown(e.target.value.length > 0);
            }}
            onFocus={() => setShowDropdown(searchTerm.length > 0)}
            placeholder="Buscar cliente por nombre, teléfono o email..."
            className="w-full pl-10 pr-4 py-2 border border-purple-200 dark:border-purple-800 bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
          />
        </div>

        {/* Dropdown Results */}
        {showDropdown && filteredClients.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-card border border-purple-200 dark:border-purple-800 rounded-lg shadow-lg max-h-64 overflow-y-auto">
            {filteredClients.slice(0, 10).map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => handleSelectClient(client)}
                className="w-full text-left p-3 hover:bg-purple-50 dark:hover:bg-purple-950/30 border-b border-border transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{client.name}</span>
                      {client.isFavorite && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {client.phone} {client.email && `• ${client.email}`}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {client.province}, {client.canton}, {client.district}
                    </div>
                  </div>
                  <div className="text-right ml-2">
                    <Badge variant="secondary" className="text-xs">
                      {client.totalOrders} pedidos
                    </Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Top Clients (when no search) */}
      {!searchTerm && topClients.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-xs text-purple-700 dark:text-purple-400">
            <TrendingUp className="w-3 h-3" />
            <span>Clientes frecuentes</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {topClients.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => handleSelectClient(client)}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-100 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-full hover:bg-purple-200 dark:hover:bg-purple-950/50 transition-colors text-sm"
              >
                {client.isFavorite && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                <span>{client.name}</span>
                <Badge variant="secondary" className="text-xs ml-1">
                  {client.totalOrders}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RecurringCustomers;

