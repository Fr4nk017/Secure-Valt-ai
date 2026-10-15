/**
 * Envoltorio HTTP de la API de administración de mensajería.
 *
 * - Autoriza: JWT de Entra ID con rol Admin (Authorization: Bearer, como el BFF
 *   de la EP1) o, sin header, la sesión de la app con rol ADMIN (panel interno).
 * - Traduce errores: validación (zod) → 400, protegido/duplicado → 409,
 *   inexistente → 404, broker no configurado → 503.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { getAuthUser } from '@/lib/auth-utils'
import { assertRole, extractBearerToken, verifyEntraToken, EntraAuthError } from '@/lib/entra/jwt'
import { isAdminEnabled } from '@/lib/messaging/admin-client'
import { MessagingAdminError, MessagingAdminService } from './messaging-admin.service'

type Handler<C> = (ctx: { request: NextRequest; service: MessagingAdminService; params: C }) => Promise<Response>

async function authorize(request: NextRequest): Promise<Response | null> {
  if (request.headers.get('authorization')) {
    const claims = await verifyEntraToken(extractBearerToken(request.headers.get('authorization')))
    assertRole(claims, ['Admin'])
    return null
  }
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'Se requiere autenticación' }, { status: 401 })
  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden_role', message: 'Solo el administrador del sistema' }, { status: 403 })
  }
  return null
}

export function messagingAdminRoute<C = Record<string, never>>(handler: Handler<C>) {
  return async (request: NextRequest, context: { params: C }) => {
    try {
      const denied = await authorize(request)
      if (denied) return denied

      if (!isAdminEnabled()) {
        throw new MessagingAdminError(503, 'broker_not_configured', 'La mensajería no está configurada (SERVICEBUS_CONNECTION_STRING)')
      }
      return await handler({ request, service: new MessagingAdminService(), params: context.params })
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json(
          {
            error: 'validation_error',
            message: 'Datos inválidos',
            details: error.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message })),
          },
          { status: 400 }
        )
      }
      if (error instanceof EntraAuthError) {
        return NextResponse.json({ error: error.code, message: error.message }, { status: error.status })
      }
      if (error instanceof MessagingAdminError) {
        return NextResponse.json({ error: error.code, message: error.message }, { status: error.status })
      }
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json', message: 'El cuerpo debe ser JSON válido' }, { status: 400 })
      }
      console.error('[messaging-admin] Error inesperado:', error)
      return NextResponse.json({ error: 'internal_error', message: 'Error interno del servidor' }, { status: 500 })
    }
  }
}
