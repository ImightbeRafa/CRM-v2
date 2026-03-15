import '@/app/components/globals.css'
import '@/app/globals-mobile.css'
import SessionProvider from "./components/Sessionprovider"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { TenantSettingsProvider } from "./contexts/TenantSettingsContext"
import { ConfigProvider } from "./contexts/ConfigContext"
import SubscriptionBanner from "./components/SubscriptionBanner"
import { ClientProviders } from "./components/ClientProviders"
import type { Metadata, Viewport } from 'next'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export const metadata: Metadata = {
  other: {
    'facebook-domain-verification': '0p9ljactuhfpuxjkd46xl1kh5m2tjd',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta name="facebook-domain-verification" content="0p9ljactuhfpuxjkd46xl1kh5m2tjd" />
      </head>
      <body className="min-h-screen bg-background">
        <ErrorBoundary>
          <SessionProvider>
            <TenantSettingsProvider>
              <ConfigProvider>
                <ClientProviders>
                  <SubscriptionBanner />
                  {children}
                </ClientProviders>
              </ConfigProvider>
            </TenantSettingsProvider>
          </SessionProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}