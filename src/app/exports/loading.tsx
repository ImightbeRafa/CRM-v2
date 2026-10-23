import { AppRouteLoading } from '@/components/aurora/states/AuroraRouteLoading'

/** App routes keep the branded loader per folder; there is no root loading.tsx so public pages paint at once. */
export default function Loading() {
  return <AppRouteLoading />
}
