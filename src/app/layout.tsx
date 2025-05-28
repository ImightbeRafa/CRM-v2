import '@/app/components/globals.css' 
import SessionProvider from "./components/Sessionprovider"

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background">
        <SessionProvider>
          {children}
        </SessionProvider>
      </body>
    </html>
  )
}