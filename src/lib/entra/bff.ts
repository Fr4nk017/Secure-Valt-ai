/**
 * Helper para API Routes del BFF (/api/bff/v1/*) protegidas con Entra ID.
 *
 * Envuelve un handler: extrae el Bearer token, lo valida (firma + claims),
 * aplica RBAC por App roles y responde 401/403 con el formato estándar
 * (incluye WWW-Authenticate, RFC 6750).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { assertRole, extractBearerToken, verifyEntraToken, EntraAuthError, type EntraClaims } from './jwt'

/** App roles definidos en la App API de Entra ID (manifest → appRoles). */
export const ENTRA_ROLES = {
  ADMIN: 'SecureVault.Admin',
  USER: 'SecureVault.User',
} as const

type Handler<C> = (request: NextRequest, claims: EntraClaims, context: C) => Promise<Response> | Response

export function withEntraAuth<C = unknown>(handler: Handler<C>, options: { roles?: string[] } = {}) {
  return async (request: NextRequest, context: C) => {
    try {
      const token = extractBearerToken(request.headers.get('authorization'))
      const claims = await verifyEntraToken(token)
      if (options.roles) assertRole(claims, options.roles)
      return await handler(request, claims, context)
    } catch (err) {
      if (err instanceof EntraAuthError) {
        const res = NextResponse.json({ error: err.code, message: err.message }, { status: err.status })
        const challenge = err.status === 401 ? 'invalid_token' : 'insufficient_scope'
        const description = err.message.replace(/"/g, "'")
        res.headers.set('WWW-Authenticate', `Bearer error="${challenge}", error_description="${description}"`)
        return res
      }
      console.error('[BFF] Error inesperado:', err)
      return NextResponse.json({ error: 'internal_error' }, { status: 500 })
    }
  }
}
