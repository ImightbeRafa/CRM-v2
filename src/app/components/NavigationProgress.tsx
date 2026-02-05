'use client';

import { useEffect, useState, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

function NavigationProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, setIsNavigating] = useState(false);

  useEffect(() => {
    // Show loading on route change
    setIsNavigating(true);
    
    // Hide after a short delay to show completion
    const timeout = setTimeout(() => {
      setIsNavigating(false);
    }, 500);

    return () => clearTimeout(timeout);
  }, [pathname, searchParams]);

  if (!isNavigating) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-blue-200">
      <div 
        className="h-full bg-blue-500 transition-all duration-500 ease-out"
        style={{
          width: '100%',
          animation: 'progress 1s ease-in-out'
        }}
      />
      <style jsx>{`
        @keyframes progress {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 100%; }
        }
      `}</style>
    </div>
  );
}

export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <NavigationProgressInner />
    </Suspense>
  );
}
