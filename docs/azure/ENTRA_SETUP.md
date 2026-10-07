# Microsoft Entra ID + MSAL + BFF + API Management (EP1 — DSY1107)

Adaptación del encargo a nuestro stack: **Next.js + Azure** en lugar de Angular + AWS.

| Pauta del encargo | Implementación en SecureVault |
|---|---|
| Angular + MSAL | Next.js + `@azure/msal-browser` / `@azure/msal-react` (`src/lib/entra/msal-config.ts`) |
| MsalGuard | `EntraGuard` (`src/components/entra/EntraGuard.tsx`) protege `/portal` |
| MsalInterceptor + protectedResourceMap | `bffFetch` (`src/lib/entra/api-client.ts`): token silencioso → redirect si requiere interacción → `Authorization: Bearer` |
| Lectura de roles/scopes desde claims | `/portal` muestra `roles` y `scp` del access token |
| BFF valida firma, iss, aud, exp + RBAC | `src/lib/entra/jwt.ts` + `withEntraAuth` → `/api/bff/v1/*` (401 / 403) |
| AWS API Gateway (JWT Authorizer) | Azure API Management con `validate-jwt` (`docs/azure/apim-policy.xml`) |
| Versionado de APIs | Por URL: `/api/bff/v1/...` |
| EC2 | Azure App Service |

```
Navegador (MSAL, PKCE) ──login──► Entra ID ──access token (JWT)──► Navegador
Navegador ──Bearer JWT──► Azure API Management (validate-jwt) ──► BFF /api/bff/v1 (jose + JWKS, RBAC) ──► Prisma / Supabase PostgreSQL
```

## 1. Registrar la App API (backend)

Entra ID → *App registrations* → *New registration* → `SecureVault API` (single tenant).

1. **Expose an API** → Application ID URI: `api://<API_CLIENT_ID>` → *Add a scope*: `access_as_user` (Admins and users).
2. **App roles** → crear (Allowed member types: Users/Groups):
   - `SecureVault.Admin` — Administrador
   - `SecureVault.User` — Usuario
3. **Manifest** → `"accessTokenAcceptedVersion": 2` (para que el `iss` sea `https://login.microsoftonline.com/<TENANT_ID>/v2.0`).
4. *Enterprise applications* → `SecureVault API` → *Users and groups* → asignar usuarios a cada rol.

## 2. Registrar la App SPA (frontend)

*New registration* → `SecureVault Web`.

1. **Authentication** → *Add a platform* → **Single-page application** → Redirect URIs:
   - `http://localhost:3000/portal`
   - `https://securevault-ai-francisco-dth5fndpbma0d2hy.brazilsouth-01.azurewebsites.net/portal`
   - Front-channel logout / post logout: `.../login`
2. **API permissions** → *Add* → *My APIs* → `SecureVault API` → `access_as_user` → **Grant admin consent**.

## 3. Variables de entorno

```env
NEXT_PUBLIC_ENTRA_TENANT_ID=<TENANT_ID>
NEXT_PUBLIC_ENTRA_CLIENT_ID=<SPA_CLIENT_ID>
NEXT_PUBLIC_ENTRA_API_SCOPE=api://<API_CLIENT_ID>/access_as_user
NEXT_PUBLIC_BFF_BASE_URL=/api/bff/v1          # o https://<apim>.azure-api.net/securevault/v1
ENTRA_TENANT_ID=<TENANT_ID>
ENTRA_API_CLIENT_ID=<API_CLIENT_ID>
ENTRA_REQUIRED_SCOPE=access_as_user
```

Las `NEXT_PUBLIC_*` se incrustan en el build: agregarlas al `env:` del paso de build en el workflow de GitHub Actions. Las `ENTRA_*` van en *App Service → Configuration*.

## 4. Azure API Management

1. Crear instancia APIM (tier **Consumption** o **Developer**).
2. *APIs* → *Add API* → HTTP → nombre `securevault`, URL suffix `securevault`, **Versioned**: esquema *Path*, versión `v1`.
3. Agregar operaciones `GET /me`, `GET /documents`, `GET /admin/audit`.
4. *All operations* → *Inbound processing* → pegar `docs/azure/apim-policy.xml` (reemplazando los `{{...}}`).
5. En *Settings* desmarcar **Subscription required** (la autenticación es por JWT).
6. Cambiar `NEXT_PUBLIC_BFF_BASE_URL` a `https://<apim>.azure-api.net/securevault/v1` y volver a desplegar.

## 5. Pruebas para la presentación

| Caso | Resultado esperado |
|---|---|
| Entrar a `/portal` sin sesión | Redirect a login de Microsoft (guard) |
| `GET /me` con sesión | 200 + claims |
| `GET /documents` con rol User/Admin | 200 |
| `GET /admin/audit` con rol User | **403** `forbidden_role` |
| Llamar al BFF sin header (curl) | **401** `missing_token` |
| Token alterado / expirado / otra audiencia | **401** `invalid_signature` / `token_expired` / `invalid_aud` |

Tests automatizados: `npx jest __tests__/lib/entra`.
