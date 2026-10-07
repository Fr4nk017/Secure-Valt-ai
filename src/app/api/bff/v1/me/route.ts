/**
 * GET /api/bff/v1/me
 *
 * Devuelve la identidad del usuario según los claims del JWT de Entra ID
 * y, si existe, su perfil vinculado en SecureVault (por email).
 * Requiere token válido con scope access_as_user (cualquier rol).
 */

import { NextResponse } from 'next/server'
import { withEntraAuth } from '@/lib/entra/bff'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export const GET = withEntraAuth(async (_request, claims) => {
  const email = (claims.preferred_username ?? claims.email)?.toLowerCase()
  const user = email
    ? await prisma.user.findUnique({
        where: { email },
        select: { id: true, name: true, email: true, role: true, company: { select: { name: true } } },
      })
    : null

  return NextResponse.json({
    identity: {
      oid: claims.oid,
      tid: claims.tid,
      name: claims.name,
      username: claims.preferred_username,
      roles: claims.roles ?? [],
      scopes: claims.scp?.split(' ') ?? [],
      expiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    },
    secureVaultUser: user,
  })
})
