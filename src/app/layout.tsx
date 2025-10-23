import '@/app/components/globals.css'
import '@/app/globals-mobile.css'
import SessionProvider from "./components/Sessionprovider"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { TenantSettingsProvider } from "./contexts/TenantSettingsContext"
import SubscriptionBanner from "./components/SubscriptionBanner"

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background">
        <ErrorBoundary>
          <SessionProvider>
            <TenantSettingsProvider>
              <SubscriptionBanner />
              {children}
            </TenantSettingsProvider>
          </SessionProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}