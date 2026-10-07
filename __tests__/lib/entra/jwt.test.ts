/**
 * @jest-environment node
 */
import { SignJWT, generateKeyPair, type KeyLike } from 'jose'
import { verifyEntraToken, assertRole, extractBearerToken, EntraAuthError, type EntraConfig } from '@/lib/entra/jwt'

const config: EntraConfig = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  apiClientId: '22222222-2222-2222-2222-222222222222',
  requiredScope: 'access_as_user',
}

let privateKey: KeyLike
let publicKey: KeyLike
let otherPrivateKey: KeyLike

beforeAll(async () => {
  ;({ privateKey, publicKey } = await generateKeyPair('RS256'))
  ;({ privateKey: otherPrivateKey } = await generateKeyPair('RS256'))
})

const getKey = async () => publicKey

function sign(claims: Record<string, unknown> = {}, opts: { key?: KeyLike; exp?: string | number } = {}) {
  return new SignJWT({ scp: 'access_as_user', tid: config.tenantId, roles: ['SecureVault.User'], ...claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(`https://login.microsoftonline.com/${config.tenantId}/v2.0`)
    .setAudience(config.apiClientId)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '1h')
    .sign(opts.key ?? privateKey)
}

async function expectAuthError(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toMatchObject({ status, code })
  await expect(promise).rejects.toBeInstanceOf(EntraAuthError)
}

describe('verifyEntraToken', () => {
  it('acepta un token válido y devuelve sus claims', async () => {
    const claims = await verifyEntraToken(await sign(), config, getKey)
    expect(claims.roles).toEqual(['SecureVault.User'])
  })

  it('rechaza una firma de otra clave (401)', async () => {
    await expectAuthError(verifyEntraToken(await sign({}, { key: otherPrivateKey }), config, getKey), 401, 'invalid_signature')
  })

  it('rechaza un token expirado (401)', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600
    await expectAuthError(verifyEntraToken(await sign({}, { exp: past }), config, getKey), 401, 'token_expired')
  })

  it('rechaza otro emisor (401)', async () => {
    const token = await new SignJWT({ scp: 'access_as_user' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://login.microsoftonline.com/otro-tenant/v2.0')
      .setAudience(config.apiClientId)
      .setExpirationTime('1h')
      .sign(privateKey)
    await expectAuthError(verifyEntraToken(token, config, getKey), 401, 'invalid_iss')
  })

  it('rechaza otra audiencia (401)', async () => {
    const token = await new SignJWT({ scp: 'access_as_user' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(`https://login.microsoftonline.com/${config.tenantId}/v2.0`)
      .setAudience('api://otra-api')
      .setExpirationTime('1h')
      .sign(privateKey)
    await expectAuthError(verifyEntraToken(token, config, getKey), 401, 'invalid_aud')
  })

  it('rechaza un token sin el scope requerido (403)', async () => {
    await expectAuthError(verifyEntraToken(await sign({ scp: 'User.Read' }), config, getKey), 403, 'insufficient_scope')
  })
})

describe('assertRole', () => {
  it('permite si el token tiene un rol permitido', () => {
    expect(() => assertRole({ roles: ['SecureVault.Admin'] }, ['SecureVault.Admin'])).not.toThrow()
  })

  it('lanza 403 si falta el rol', () => {
    expect(() => assertRole({ roles: ['SecureVault.User'] }, ['SecureVault.Admin'])).toThrow(
      expect.objectContaining({ status: 403, code: 'forbidden_role' }),
    )
  })
})

describe('extractBearerToken', () => {
  it('extrae el token del header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('lanza 401 si falta el header o el esquema no es Bearer', () => {
    expect(() => extractBearerToken(null)).toThrow(expect.objectContaining({ status: 401 }))
    expect(() => extractBearerToken('Basic xyz')).toThrow(expect.objectContaining({ status: 401 }))
  })
})
