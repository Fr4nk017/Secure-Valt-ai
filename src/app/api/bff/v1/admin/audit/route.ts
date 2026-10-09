/**
 * GET /api/bff/v1/admin/audit
 *
 * Últimos eventos de auditoría del sistema.
 * Requiere App role Admin (otro rol → 403).
 */

import { NextResponse } from 'next/server'
import { withEntraAuth, ENTRA_ROLES } from '@/lib/entra/bff'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export const GET = withEntraAuth(
  async () => {
    const events = await prisma.auditLog.findMany({
      select: { id: true, action: true, createdAt: true, user: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return NextResponse.json({ events })
  },
  { roles: [ENTRA_ROLES.ADMIN] },
)
