'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationProgress } from './NavigationProgress';
import { FeedbackWidget } from './FeedbackWidget';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === 'undefined') return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function ClientProviders({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = getQueryClient();

  const excludedPaths = ['/home', '/landing', '/auth', '/terms', '/privacy', '/setup-wizard', '/setup-tenant', '/docs', '/help'];

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user) return;

    const isExcludedPath = excludedPaths.some(path => pathname?.startsWith(path));
    if (isExcludedPath) return;

    const checkProfile = async () => {
      try {
        const res = await fetch('/api/tenant/profile');
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.profile && !data.profile.profileCompleted) {
            router.push('/setup-wizard');
          }
        }
      } catch (error) {
        console.error('Error checking profile:', error);
      }
    };

    const timeout = setTimeout(checkProfile, 1000);
    return () => clearTimeout(timeout);
  }, [status, session, pathname, router]);

  return (
    <QueryClientProvider client={queryClient}>
      <NavigationProgress />
      {children}
      <FeedbackWidget />
    </QueryClientProvider>
  );
}
