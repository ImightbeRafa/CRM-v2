export default async function SocialConfigLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // No permission check here; the page itself checks for Owner/Master
  return <>{children}</>
}
