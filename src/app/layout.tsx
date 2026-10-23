import '@/app/components/globals.css'
import '@/app/theme-palette.css'
import '@/app/globals-mobile.css'
import { Plus_Jakarta_Sans, Space_Grotesk } from 'next/font/google'
import SessionProvider from "./components/Sessionprovider"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { TenantSettingsProvider } from "./contexts/TenantSettingsContext"
import { ConfigProvider } from "./contexts/ConfigContext"
import { AppTopBanners } from "./components/AppTopBanners"
import { ClientProviders } from "./components/ClientProviders"
import { ThemeProvider } from "./components/ThemeProvider"
import { AuroraFrame } from "@/components/aurora/AuroraShell"
import MetaPixel from "./components/MetaPixel"
import { shouldShowPreviewDataWarning } from "@/lib/review-environment"
import type { Metadata, Viewport } from 'next'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
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
  // Lets env(safe-area-inset-*) report real values (bottom nav, sheets, home indicator).
  viewportFit: 'cover',
}

/** Official Betsy mark (docs/design/betsy-mascot-handoff): favicons + the default share image. */
const OG_DARK = { url: '/brand/betsy/og-dark-1200x630.png', width: 1200, height: 630, alt: 'Betsy' }

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://www.betsycrm.com'),
  icons: {
    icon: [
      { url: '/brand/betsy/favicon.svg', type: 'image/svg+xml' },
      { url: '/brand/betsy/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/brand/betsy/apple-touch-icon-180.png', sizes: '180x180' }],
  },
  openGraph: { siteName: 'Betsy', type: 'website', locale: 'es_CR', images: [OG_DARK] },
  twitter: { card: 'summary_large_image', images: [OG_DARK.url] },
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
                    <AppTopBanners showPreviewWarning={shouldShowPreviewDataWarning()} />
                    <AuroraFrame>{children}</AuroraFrame>
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