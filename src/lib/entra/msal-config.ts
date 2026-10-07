/**
 * Configuración de MSAL (lado cliente) para Microsoft Entra ID.
 *
 * - clientId   → Application (client) ID de la App SPA
 * - authority  → https://login.microsoftonline.com/{tenantId}
 * - apiScope   → scope delegado expuesto por la App API (api://<API_CLIENT_ID>/access_as_user)
 *
 * El flujo es Authorization Code + PKCE (MSAL lo aplica automáticamente en SPA),
 * por lo que no hay secretos en el cliente.
 */

import { LogLevel, type Configuration } from '@azure/msal-browser'

const tenantId = process.env.NEXT_PUBLIC_ENTRA_TENANT_ID ?? ''
const clientId = process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID ?? ''

export const apiScope = process.env.NEXT_PUBLIC_ENTRA_API_SCOPE ?? ''

/** URL base del BFF. En producción apunta al gateway de Azure API Management. */
export const bffBaseUrl = (process.env.NEXT_PUBLIC_BFF_BASE_URL ?? '/api/bff/v1').replace(/\/$/, '')

export const isEntraConfigured = Boolean(tenantId && clientId && apiScope)

export function buildMsalConfig(origin: string): Configuration {
  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: `${origin}/portal`,
      postLogoutRedirectUri: `${origin}/login`,
      navigateToLoginRequestUrl: true,
    },
    cache: {
      cacheLocation: 'sessionStorage',
    },
    system: {
      loggerOptions: {
        logLevel: LogLevel.Warning,
        piiLoggingEnabled: false,
        loggerCallback: (level, message) => {
          if (level === LogLevel.Error) console.error('[MSAL]', message)
        },
      },
    },
  }
}

/** Scopes pedidos al iniciar sesión (OIDC + permiso delegado sobre la API). */
export const loginRequest = {
  scopes: ['openid', 'profile', 'email', apiScope],
}

/**
 * Equivalente al protectedResourceMap de MsalInterceptor (Angular):
 * cada prefijo de URL protegido se asocia a los scopes del token que se adjunta.
 */
export const protectedResourceMap = new Map<string, string[]>([[bffBaseUrl, [apiScope]]])
