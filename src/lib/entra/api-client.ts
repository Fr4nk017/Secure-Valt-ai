/**
 * Interceptor HTTP para el BFF (equivalente a MsalInterceptor de Angular).
 *
 * Para cada request a una URL del protectedResourceMap:
 *   1. Adquiere el access token en silencio (cache / refresh token).
 *   2. Si se requiere interacción (consentimiento, sesión expirada),
 *      conmuta al flujo interactivo por redirect.
 *   3. Adjunta `Authorization: Bearer <access_token>`.
 */

import {
  InteractionRequiredAuthError,
  type IPublicClientApplication,
} from '@azure/msal-browser'
import { bffBaseUrl, protectedResourceMap } from './msal-config'

function scopesFor(url: string): string[] | null {
  for (const [prefix, scopes] of Array.from(protectedResourceMap)) {
    if (url.startsWith(prefix)) return scopes
  }
  return null
}

export async function acquireApiToken(instance: IPublicClientApplication, scopes: string[]) {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0]
  if (!account) throw new Error('No hay una sesión de Entra ID activa')
  try {
    return await instance.acquireTokenSilent({ scopes, account })
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await instance.acquireTokenRedirect({ scopes, account })
    }
    throw err
  }
}

/** fetch() hacia el BFF con el token adjunto automáticamente. `path` es relativo a la versión (ej. "/me"). */
export async function bffFetch(instance: IPublicClientApplication, path: string, init: RequestInit = {}) {
  const url = `${bffBaseUrl}${path}`
  const headers = new Headers(init.headers)
  const scopes = scopesFor(url)
  if (scopes) {
    const { accessToken } = await acquireApiToken(instance, scopes)
    headers.set('Authorization', `Bearer ${accessToken}`)
  }
  return fetch(url, { ...init, headers })
}

/** Decodifica el payload de un JWT para mostrar claims en la UI (NO valida; eso lo hace el BFF). */
export function decodeJwtPayload<T = Record<string, unknown>>(jwt: string): T {
  const part = jwt.split('.')[1] ?? ''
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))
  return JSON.parse(decodeURIComponent(escape(json))) as T
}
