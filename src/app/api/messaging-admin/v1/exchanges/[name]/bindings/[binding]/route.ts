/**
 * DELETE /api/messaging-admin/v1/exchanges/{name}/bindings/{binding} — elimina un binding (los que usa la app están protegidos).
 */

import { entityNameSchema, messagingAdminRoute } from '@/modules/messaging-admin/api'

export const dynamic = 'force-dynamic'

export const DELETE = messagingAdminRoute<{ name: string; binding: string }>(async ({ service, params }) => {
  await service.deleteBinding(entityNameSchema.parse(params.name), entityNameSchema.parse(params.binding))
  return new Response(null, { status: 204 })
})
