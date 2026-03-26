import '@/app/components/globals.css'
import '@/app/globals-mobile.css'
import { Plus_Jakarta_Sans, Space_Grotesk } from 'next/font/google'
import SessionProvider from "./components/Sessionprovider"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { TenantSettingsProvider } from "./contexts/TenantSettingsContext"
import { ConfigProvider } from "./contexts/ConfigContext"
import SubscriptionBanner from "./components/SubscriptionBanner"
import { ClientProviders } from "./components/ClientProviders"
import { ThemeProvider } from "./components/ThemeProvider"
import MetaPixel from "./components/MetaPixel"
import type { Metadata, Viewport } from 'next'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['700'],
  variable: '--font-logo',
  display: 'swap',
})

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
    <html lang="en" className={`${jakarta.variable} ${spaceGrotesk.variable}`} suppressHydrationWarning>
      <head>
        <meta name="facebook-domain-verification" content="0p9ljactuhfpuxjkd46xl1kh5m2tjd" />
      </head>
      <body className={`${jakarta.className} min-h-screen bg-background text-foreground`}>
        <MetaPixel />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
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
        </ThemeProvider>
      </body>
    </html>
  )
}