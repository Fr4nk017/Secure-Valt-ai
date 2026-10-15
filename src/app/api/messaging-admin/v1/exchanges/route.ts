/**
 * GET  /api/messaging-admin/v1/exchanges — lista los exchanges (topics) y sus bindings.
 * POST /api/messaging-admin/v1/exchanges — crea un exchange. Body: { name, defaultMessageTimeToLive? }
 */

import { NextResponse } from 'next/server'
import { createExchangeSchema, messagingAdminRoute } from '@/modules/messaging-admin/api'

export const dynamic = 'force-dynamic'

export const GET = messagingAdminRoute(async ({ service }) =>
  NextResponse.json({ data: await service.listExchanges() })
)

export const POST = messagingAdminRoute(async ({ request, service }) => {
  const input = createExchangeSchema.parse(await request.json())
  return NextResponse.json({ data: await service.createExchange(input) }, { status: 201 })
})
