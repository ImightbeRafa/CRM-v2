'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { NavigationProgress } from './NavigationProgress';
import ProfileCompletionModal from './ProfileCompletionModal';

export function ClientProviders({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [tenantInfo, setTenantInfo] = useState<{ name?: string; ownerName?: string } | null>(null);

  // Paths that should not show the profile completion modal
  const excludedPaths = ['/home', '/landing', '/auth', '/terms', '/privacy', '/setup-wizard', '/setup-tenant'];
  
  useEffect(() => {
    // Only check for authenticated users on non-excluded paths
    if (status !== 'authenticated' || !session?.user) return;
    
    // Skip check on excluded paths
    const isExcludedPath = excludedPaths.some(path => pathname?.startsWith(path));
    if (isExcludedPath) return;

    // Check if we already dismissed recently (stored in localStorage)
    const dismissedUntil = localStorage.getItem('profileCompletionDismissed');
    if (dismissedUntil) {
      const dismissedDate = new Date(dismissedUntil);
      const now = new Date();
      if (now.getTime() - dismissedDate.getTime() < 7 * 24 * 60 * 60 * 1000) {
        return; // Still within dismissal period
      }
    }

    // Fetch tenant profile to check if it's complete
    const checkProfile = async () => {
      try {
        const res = await fetch('/api/tenant/profile');
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.profile) {
            const profile = data.profile;
            // Show modal if profile is not completed
            if (!profile.profileCompleted) {
              setTenantInfo({
                name: profile.businessName || profile.name,
                ownerName: profile.ownerName
              });
              setShowProfileModal(true);
            }
          }
        }
      } catch (error) {
        console.error('Error checking profile:', error);
      }
    };

    // Delay check slightly to avoid blocking initial load
    const timeout = setTimeout(checkProfile, 1500);
    return () => clearTimeout(timeout);
  }, [status, session, pathname]);

  return (
    <>
      <NavigationProgress />
      {children}
      
      {/* Profile Completion Modal */}
      <ProfileCompletionModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        onComplete={() => {
          setShowProfileModal(false);
          // Clear dismissal flag on completion
          localStorage.removeItem('profileCompletionDismissed');
        }}
        tenantName={tenantInfo?.name}
        ownerName={tenantInfo?.ownerName}
      />
    </>
  );
}
