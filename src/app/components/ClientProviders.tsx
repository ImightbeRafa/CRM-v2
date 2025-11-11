'use client';

import { NavigationProgress } from './NavigationProgress';

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NavigationProgress />
      {children}
    </>
  );
}
