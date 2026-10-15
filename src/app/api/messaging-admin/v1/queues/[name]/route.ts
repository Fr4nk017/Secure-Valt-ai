/**
 * DELETE /api/messaging-admin/v1/queues/{name} — elimina una cola (las del sistema están protegidas).
 */

import { entityNameSchema, messagingAdminRoute } from '@/modules/messaging-admin/api'

export const dynamic = 'force-dynamic'

export const DELETE = messagingAdminRoute<{ name: string }>(async ({ service, params }) => {
  await service.deleteQueue(entityNameSchema.parse(params.name))
  return new Response(null, { status: 204 })
})
