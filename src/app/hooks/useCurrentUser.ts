import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';

interface User {
  id: string;
  username: string;
  role: 'MASTER' | 'REGULAR';
  active: boolean;
}

// Cache user data to avoid repeated API calls
let cachedUser: User | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60000; // 1 minute

export function useCurrentUser() {
  const { data: session, status } = useSession();
  const [user, setUser] = useState<User | null>(cachedUser);
  const [loading, setLoading] = useState(!cachedUser);

  useEffect(() => {
    const fetchUser = async () => {
      if (status === 'loading') return;
      
      if (!session) {
        setUser(null);
        setLoading(false);
        cachedUser = null;
        return;
      }

      // Use cache if available and fresh
      const now = Date.now();
      if (cachedUser && (now - cacheTimestamp) < CACHE_DURATION) {
        setUser(cachedUser);
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        const data = await response.json();
        
        if (data.status === 'success') {
          cachedUser = data.data;
          cacheTimestamp = now;
          setUser(data.data);
        } else {
          cachedUser = null;
          setUser(null);
        }
      } catch (error) {
        console.error('Error fetching user:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [session, status]);

  return { user, loading, isAuthenticated: !!session };
}
