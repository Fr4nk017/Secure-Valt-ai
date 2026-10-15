/**
 * GET  /api/messaging-admin/v1/exchanges/{name}/bindings — lista los bindings del exchange con sus routing keys.
 * POST /api/messaging-admin/v1/exchanges/{name}/bindings — crea un binding.
 *      Body: { name, routingKeys: ["document.uploaded", ...], maxDeliveryCount?, lockDuration?, deadLetteringOnMessageExpiration? }
 */

import { NextResponse } from 'next/server'
import { createBindingSchema, entityNameSchema, messagingAdminRoute } from '@/modules/messaging-admin/api'

export const dynamic = 'force-dynamic'

export const GET = messagingAdminRoute<{ name: string }>(async ({ service, params }) =>
  NextResponse.json({ data: await service.listBindings(entityNameSchema.parse(params.name)) })
)

export const POST = messagingAdminRoute<{ name: string }>(async ({ request, service, params }) => {
  const exchange = entityNameSchema.parse(params.name)
  const input = createBindingSchema.parse(await request.json())
  return NextResponse.json({ data: await service.createBinding(exchange, input) }, { status: 201 })
})
