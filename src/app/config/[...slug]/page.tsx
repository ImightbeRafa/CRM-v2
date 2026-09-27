import { redirect } from 'next/navigation'
import { configPathAliasToHref } from '@/components/aurora/config/config-nav'

type SearchParams = Record<string, string | string[] | undefined>

/**
 * Catch-all for `/config/<x>[/…]` paths that are not real pages (clientes, equipo, plan,
 * integraciones, unknown…). Static siblings (`social`, `ai-assistant`, …) win over this route.
 */
export default async function ConfigPathRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string[] }>
  searchParams: Promise<SearchParams>
}) {
  const { slug } = await params
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((v) => sp.append(key, v))
    else if (value !== undefined) sp.append(key, value)
  }
  redirect(configPathAliasToHref(slug, sp))
}
