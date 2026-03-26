'use client';

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
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <NavigationProgress />
      {children}
      <FeedbackWidget />
    </QueryClientProvider>
  );
}
