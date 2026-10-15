/**
 * GET  /api/messaging-admin/v1/queues — lista las colas con mensajes activos y en DLQ.
 * POST /api/messaging-admin/v1/queues — crea una cola. Body: { name, maxDeliveryCount?, lockDuration?, defaultMessageTimeToLive?, deadLetteringOnMessageExpiration? }
 */

import { NextResponse } from 'next/server'
import { createQueueSchema, messagingAdminRoute } from '@/modules/messaging-admin/api'

export const dynamic = 'force-dynamic'

export const GET = messagingAdminRoute(async ({ service }) =>
  NextResponse.json({ data: await service.listQueues() })
)

export const POST = messagingAdminRoute(async ({ request, service }) => {
  const input = createQueueSchema.parse(await request.json())
  return NextResponse.json({ data: await service.createQueue(input) }, { status: 201 })
})
