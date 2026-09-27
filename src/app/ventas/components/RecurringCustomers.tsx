import React, { useState, useEffect } from 'react';
import { Users, Search, Clock, Star, TrendingUp } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { CustomerSuggestion } from './types';
import { sfInput } from './sales-form-styles';

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
    <div className="mb-5 space-y-3 rounded-xl bg-gradient-to-br from-[#F6F4FF] to-white p-3 ring-1 ring-[#E4DEFF] sm:p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[#5B3FE0]" />
          <h4 className="text-[13px] font-semibold text-slate-800">Clientes Recurrentes</h4>
        </div>
        <Button
          type="button"
          onClick={handleSyncClients}
          disabled={loading}
          size="sm"
          variant="outline"
          className="h-8 rounded-lg border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {loading ? 'Sincronizando...' : 'Sincronizar'}
        </Button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setShowDropdown(e.target.value.length > 0);
            }}
            onFocus={() => setShowDropdown(searchTerm.length > 0)}
            placeholder="Buscar cliente por nombre, teléfono o email..."
            className={`${sfInput()} pl-9`}
          />
        </div>

        {/* Dropdown Results */}
        {showDropdown && filteredClients.length > 0 && (
          <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
            {filteredClients.slice(0, 10).map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => handleSelectClient(client)}
                className="w-full border-b border-slate-100 p-3 text-left transition-colors last:border-0 hover:bg-[#F6F4FF]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{client.name}</span>
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
          <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            <TrendingUp className="w-3 h-3" />
            <span>Clientes frecuentes</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {topClients.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => handleSelectClient(client)}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px] text-slate-700 shadow-sm ring-1 ring-slate-200 transition-all hover:-translate-y-px hover:text-[#5B3FE0] hover:ring-[#7C5CFF]/40"
              >
                {client.isFavorite && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                <span>{client.name}</span>
                <span className="rounded-full bg-[#F1EEFF] px-1.5 text-[11px] font-semibold text-[#5B3FE0]">
                  {client.totalOrders}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RecurringCustomers;

