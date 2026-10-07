/**
 * Validación de JWT emitidos por Microsoft Entra ID (IDaaS) — lado BFF.
 *
 * El BFF no guarda secretos compartidos: obtiene las claves públicas del
 * tenant (JWKS) y verifica con ellas la firma RS256 del access token.
 * Además valida los claims críticos:
 *   - iss  → emitido por nuestro tenant (endpoint v2.0)
 *   - aud  → destinado a la App API de SecureVault
 *   - exp / nbf → vigencia
 *   - scp  → permiso delegado (ej. access_as_user)
 *   - roles → App roles asignados al usuario (RBAC)
 *
 * Importar solo en código de servidor.
 */

import { createRemoteJWKSet, jwtVerify, errors, type JWTPayload, type JWTVerifyGetKey } from 'jose'

export interface EntraClaims extends JWTPayload {
  oid?: string
  tid?: string
  scp?: string
  roles?: string[]
  name?: string
  preferred_username?: string
  email?: string
}

export interface EntraConfig {
  tenantId: string
  apiClientId: string
  requiredScope: string
}

export class EntraAuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'EntraAuthError'
  }
}

export function getEntraConfig(): EntraConfig {
  const tenantId = process.env.ENTRA_TENANT_ID
  const apiClientId = process.env.ENTRA_API_CLIENT_ID
  if (!tenantId || !apiClientId) {
    throw new Error('Faltan ENTRA_TENANT_ID o ENTRA_API_CLIENT_ID en las variables de entorno')
  }
  return {
    tenantId,
    apiClientId,
    requiredScope: process.env.ENTRA_REQUIRED_SCOPE ?? 'access_as_user',
  }
}

// Cache del JWKS por tenant (jose además cachea y rota las claves internamente)
const jwksCache = new Map<string, JWTVerifyGetKey>()

function getJwks(tenantId: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(tenantId)
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
    )
    jwksCache.set(tenantId, jwks)
  }
  return jwks
}

/** Extrae el token del header `Authorization: Bearer <jwt>`. */
export function extractBearerToken(authorization: string | null): string {
  if (!authorization) {
    throw new EntraAuthError(401, 'missing_token', 'Falta el header Authorization')
  }
  const [scheme, token] = authorization.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new EntraAuthError(401, 'invalid_header', 'El header Authorization debe ser "Bearer <token>"')
  }
  return token
}

/**
 * Verifica firma, iss, aud, exp/nbf y el scope requerido.
 * `getKey` es inyectable para pruebas; por defecto usa el JWKS del tenant.
 */
export async function verifyEntraToken(
  token: string,
  config: EntraConfig = getEntraConfig(),
  getKey: JWTVerifyGetKey = getJwks(config.tenantId),
): Promise<EntraClaims> {
  let payload: EntraClaims
  try {
    const result = await jwtVerify<EntraClaims>(token, getKey, {
      algorithms: ['RS256'],
      // Tokens v2.0 (accessTokenAcceptedVersion = 2 en el manifest de la App API)
      issuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
      // En v2.0 el aud es el client ID; se acepta también el Application ID URI
      audience: [config.apiClientId, `api://${config.apiClientId}`],
      requiredClaims: ['exp', 'iss', 'aud'],
      clockTolerance: 60,
    })
    payload = result.payload
  } catch (err) {
    if (err instanceof errors.JWTExpired) {
      throw new EntraAuthError(401, 'token_expired', 'El token expiró')
    }
    if (err instanceof errors.JWTClaimValidationFailed) {
      throw new EntraAuthError(401, `invalid_${err.claim}`, `Claim "${err.claim}" inválido`)
    }
    if (err instanceof errors.JWSSignatureVerificationFailed || err instanceof errors.JWKSNoMatchingKey) {
      throw new EntraAuthError(401, 'invalid_signature', 'La firma del token no es válida')
    }
    throw new EntraAuthError(401, 'invalid_token', 'Token inválido')
  }

  if (payload.tid && payload.tid !== config.tenantId) {
    throw new EntraAuthError(401, 'invalid_tid', 'El token pertenece a otro tenant')
  }

  const scopes = payload.scp?.split(' ') ?? []
  if (!scopes.includes(config.requiredScope)) {
    throw new EntraAuthError(403, 'insufficient_scope', `Se requiere el scope "${config.requiredScope}"`)
  }

  return payload
}

/** RBAC: exige que el token tenga al menos uno de los App roles indicados. */
export function assertRole(claims: EntraClaims, allowed: string[]): void {
  const roles = claims.roles ?? []
  if (!allowed.some((r) => roles.includes(r))) {
    throw new EntraAuthError(403, 'forbidden_role', `Se requiere uno de los roles: ${allowed.join(', ')}`)
  }
}
