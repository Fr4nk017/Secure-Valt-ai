/**
 * DELETE /api/messaging-admin/v1/exchanges/{name} — elimina un exchange (los del sistema están protegidos).
 */

import { entityNameSchema, messagingAdminRoute } from '@/modules/messaging-admin/api'

export const dynamic = 'force-dynamic'

export const DELETE = messagingAdminRoute<{ name: string }>(async ({ service, params }) => {
  await service.deleteExchange(entityNameSchema.parse(params.name))
  return new Response(null, { status: 204 })
})
