import React, { useEffect, useState } from 'react';

export const StatusUpdateButton = ({ 
    currentStatus, 
    orderId,
    onUpdate 
  }: { 
    currentStatus: string;
    orderId: string;
    onUpdate: (orderId: string, newStatus: string) => Promise<void>;
  }) => {
    const [updating, setUpdating] = useState(false);
    
    const [statuses, setStatuses] = useState<string[]>([]);
    useEffect(() => {
      (async () => {
        try {
          const res = await fetch('/api/config/status');
          const json = await res.json();
          if (json.status === 'success') setStatuses(json.data.map((s: any) => s.label));
        } catch {}
      })();
    }, []);
    
    return (
      <select
        className={`rounded-md border px-3 py-1.5 text-sm ${
          updating ? 'opacity-50' : ''
        }`}
        value={currentStatus}
        disabled={updating}
        onChange={async (e) => {
          setUpdating(true);
          try {
            await onUpdate(orderId, e.target.value);
          } finally {
            setUpdating(false);
          }
        }}
      >
        {statuses.map(status => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
    );
  };