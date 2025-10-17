import '@/app/components/globals.css' 
import SessionProvider from "./components/Sessionprovider"
import { OnboardingRedirect } from "./components/OnboardingRedirect"
import { ErrorBoundary } from "./components/ErrorBoundary"

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
            <OnboardingRedirect />
            {children}
          </SessionProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}