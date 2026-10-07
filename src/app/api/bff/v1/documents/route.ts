/**
 * GET /api/bff/v1/documents
 *
 * Lista los documentos activos de la empresa del usuario autenticado.
 * Requiere App role SecureVault.User o SecureVault.Admin.
 */

import { NextResponse } from 'next/server'
import { withEntraAuth, ENTRA_ROLES } from '@/lib/entra/bff'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export const GET = withEntraAuth(
  async (_request, claims) => {
    const email = (claims.preferred_username ?? claims.email)?.toLowerCase()
    const user = email
      ? await prisma.user.findUnique({ where: { email }, select: { companyId: true } })
      : null

    if (!user) {
      return NextResponse.json(
        { error: 'user_not_linked', message: 'La cuenta de Entra ID no está vinculada a un usuario de SecureVault' },
        { status: 404 },
      )
    }

    const documents = await prisma.document.findMany({
      where: { companyId: user.companyId, status: 'ACTIVE' },
      select: { id: true, name: true, mimeType: true, sizeBytes: true, confidentialityLevel: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return NextResponse.json({ documents })
  },
  { roles: [ENTRA_ROLES.USER, ENTRA_ROLES.ADMIN] },
)
