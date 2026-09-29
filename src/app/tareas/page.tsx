import { requirePermission } from '@/lib/auth-helpers'
import { MyTasksClient } from './MyTasksClient'

export const dynamic = 'force-dynamic'

export default async function TareasPage() {
  // Tasks live on chats: same gate as the inbox.
  await requirePermission('update_sales')
  return <MyTasksClient />
}
