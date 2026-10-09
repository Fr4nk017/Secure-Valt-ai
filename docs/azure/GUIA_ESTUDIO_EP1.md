# Guía de estudio — EP1 DSY1107 en SecureVault AI

Repositorio: Fr4nk017/Secure-Valt-ai · Rama: feat/entra-id-2fa · Estado: funcionando en local; despliegue en Azure y API Management pendientes.

## 1. Qué pide la evaluación y cómo lo adaptamos

La EP1 (Desarrollo Cloud Native I, 16% de la nota, caso "Pedidos360") pide Angular + MSAL + Azure AD (Entra ID) + microservicios Spring Boot en AWS EC2 detrás de AWS API Gateway, con un BFF que valida el JWT. La rúbrica tiene dos indicadores:

- Indicador 1 (60%): Integración de MSAL. Login y logout sin fallas, guards e interceptor funcionando, obtención del token para el API Gateway y lectura de roles/scopes desde los claims.
- Indicador 2 (40%): Validación del JWT en el BFF y API Manager. Verificar firma, vigencia (exp), emisor (iss) y audiencia (aud); autorizar por rol y devolver los códigos de error correctos (401/403).

No tenemos AWS por parte de la institución, así que usamos las tecnologías del proyecto (Next.js) y Azure:

| Rúbrica (AWS/Angular) | Nuestra implementación |
|---|---|
| Angular + MSAL Angular | Next.js + @azure/msal-browser y @azure/msal-react |
| MsalGuard | EntraGuard (MsalAuthenticationTemplate con redirect) |
| MsalInterceptor + protectedResourceMap | bffFetch(): adquiere token silencioso y agrega Authorization: Bearer |
| Backend Spring Boot con filtro JWT | BFF en Next.js (/api/bff/v1/*) con la librería jose |
| AWS API Gateway + JWT Authorizer | Azure API Management + política validate-jwt |
| EC2 | Azure App Service (securevault-ai-francisco) |
| Azure AD / Entra ID | Tenant propio "Francisco" (FracLevi.onmicrosoft.com) |

## 2. Conceptos clave (Unidad 1)

- IDaaS: la identidad la gestiona un servicio externo (Entra ID). La app no guarda contraseñas: delega el login.
- OAuth 2.0: protocolo de autorización. Entrega un access token para llamar APIs.
- OpenID Connect (OIDC): capa de identidad sobre OAuth 2.0. Entrega un ID token con datos del usuario.
- Authorization Code + PKCE: flujo recomendado para aplicaciones de página única (SPA). La app genera un code_verifier secreto y envía su hash (code_challenge, método S256). Así no se necesita un client secret en el navegador. MSAL lo hace automáticamente.
- JWT: token firmado con tres partes (header.payload.firma). La firma la hace Entra ID con su clave privada RSA; cualquiera puede verificarla con la clave pública (JWKS).
- Claims importantes:
  - iss: quién emitió el token → https://login.microsoftonline.com/{tenant}/v2.0
  - aud: para quién es → el client ID de la App API
  - exp: hasta cuándo es válido
  - scp: permisos delegados → access_as_user
  - roles: App roles asignados al usuario → Admin, User
  - oid / tid: id del usuario y del tenant
- JWKS: endpoint público con las claves públicas del tenant: https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys
- BFF (Backend for Frontend): capa de backend dedicada al frontend que valida el token antes de tocar datos.
- API Manager / Gateway: puerta de entrada que valida el token, aplica rate limiting y CORS, y enruta al backend. Versionado por URL (/v1).

## 3. Arquitectura y flujo completo

1. El usuario entra a /portal. El guard (EntraGuard) detecta que no hay sesión y redirige a login.microsoftonline.com.
2. MSAL envía la petición /authorize con: client_id de la SPA, scopes (openid profile email api://<API>/access_as_user offline_access), redirect_uri .../portal, response_type=code y code_challenge (PKCE S256).
3. El usuario inicia sesión y acepta los permisos (consentimiento).
4. Entra ID redirige a /portal con un "code". MSAL lo canjea por tokens (ID token, access token y refresh token) enviando el code_verifier.
5. El portal decodifica el access token para mostrar roles y scopes. Esto es solo visual; la seguridad la aplica el BFF.
6. Al llamar a la API, bffFetch() obtiene el token con acquireTokenSilent (desde caché o con el refresh token) y agrega el header Authorization: Bearer <token>. Si se necesita interacción, cambia a acquireTokenRedirect.
7. En producción la llamada pasa primero por Azure API Management, que valida el JWT con validate-jwt y la reenvía al BFF.
8. El BFF valida otra vez (defensa en profundidad): firma con JWKS, iss, aud, exp, tid y scope. Luego aplica RBAC por roles y responde 200, 401 o 403.

## 4. Configuración realizada en Azure (portal)

### 4.1 Tenant
La cuenta institucional @duocuc.cl no tiene acceso a Entra ID ni a App registrations en el tenant de Duoc ("No tiene acceso"). Según las fuentes 1.2.2 y 1.2.4, un tenant es una instancia aislada del servicio de identidad, así que usamos un tenant propio donde somos administradores:
- Tenant: Francisco (FracLevi.onmicrosoft.com)
- Tenant ID: 2ce3b98a-6107-4394-8c67-ab37c7dc7135
- Acceso directo a "Administrar inquilinos": portal.azure.com/#view/Microsoft_AAD_IAM/DirectorySwitchBlade

### 4.2 App API: "SecureVault API" (el recurso protegido)
- Client ID: 0b1a7455-d813-4d1a-a234-84d9ae910fad
- Tipo de cuenta: solo este directorio (single tenant). Sin redirect URI.
- Exponer una API: Application ID URI api://0b1a7455-d813-4d1a-a234-84d9ae910fad y scope access_as_user (administradores y usuarios).
- Roles de aplicación: Administrador (valor Admin) y Usuario (valor User), para usuarios y grupos.
- Configuración de token: claim opcional email en el access token.
- Manifiesto: requestedAccessTokenVersion = 2 (accessTokenAcceptedVersion en el manifiesto antiguo).

### 4.3 App SPA: "SecureVault Web" (el cliente)
- Client ID: 8971c3d3-dc5b-4310-a9a3-64536c881858
- Plataforma: aplicación de página única (SPA). Esto habilita Authorization Code + PKCE.
- Redirect URIs: http://localhost:3000/portal y https://securevault-ai-francisco-dth5fndpbma0d2hy.brazilsouth-01.azurewebsites.net/portal
- Cierre de sesión de canal frontal: .../login
- Concesión implícita: desmarcada (no se usa el implicit flow).
- Permisos de API: SecureVault API → access_as_user (delegado) + consentimiento de administrador.

### 4.4 Asignación de roles (pendiente de completar)
Aplicaciones empresariales → SecureVault API → Usuarios y grupos → asignar Administrador o Usuario. Sin esto el claim roles viene vacío y el BFF responde 403 en las rutas protegidas por rol.

## 5. Problema real que resolvimos: token v1 vs v2 (buena pregunta de presentación)

Primera prueba: los tres endpoints respondían 401 invalid_iss. Al decodificar el token vimos:
- iss: https://sts.windows.net/2ce3b98a-.../ (formato v1)
- ver: 1.0
- aud: api://0b1a7455-...

Causa: por defecto, Entra ID emite access tokens v1 para las APIs registradas. Nuestro BFF (igual que el material del curso) exige el emisor v2.0. Solución: en el manifiesto de la App API cambiar la versión del token a 2. Después del cambio (y de cerrar sesión para obtener un token nuevo) el token quedó así:
- iss: https://login.microsoftonline.com/2ce3b98a-.../v2.0
- ver: 2.0
- aud: 0b1a7455-... (en v2 la audiencia es el client ID)

Esto demuestra que el BFF realmente valida iss: si no lo hiciera, habría aceptado el token v1.

## 6. Código implementado (dónde está cada cosa)

| Archivo | Rol |
|---|---|
| src/lib/entra/msal-config.ts | clientId, authority, redirectUri, scopes, cacheLocation sessionStorage, protectedResourceMap |
| src/components/entra/EntraProvider.tsx | Crea e inicializa PublicClientApplication; fija la cuenta activa tras LOGIN_SUCCESS |
| src/components/entra/EntraGuard.tsx | Guard: MsalAuthenticationTemplate con InteractionType.Redirect |
| src/lib/entra/api-client.ts | Interceptor bffFetch(): acquireTokenSilent → fallback acquireTokenRedirect → header Bearer |
| src/app/portal/page.tsx | Portal: muestra nombre, roles (claim roles), scopes (claim scp), vigencia y aud; llama a los endpoints; logoutRedirect |
| src/lib/entra/jwt.ts | Validación: jose jwtVerify con createRemoteJWKSet (JWKS), RS256, issuer v2.0, audience, requiredClaims exp/iss/aud, tid, scope; assertRole |
| src/lib/entra/bff.ts | withEntraAuth(): wrapper que responde 401/403 con header WWW-Authenticate (RFC 6750) |
| src/app/api/bff/v1/me | Cualquier usuario autenticado → identidad desde claims |
| src/app/api/bff/v1/documents | Rol User o Admin → documentos de su empresa |
| src/app/api/bff/v1/admin/audit | Solo rol Admin → últimos eventos de auditoría |
| docs/azure/apim-policy.xml | Política de API Management: cors, validate-jwt (openid-config, audiences, issuers, required scp), rate-limit-by-key, set-backend-service |
| __tests__/lib/entra/jwt.test.ts | 10 pruebas: token válido, firma de otra clave, expirado, otro emisor, otra audiencia, sin scope, roles y header Bearer |

Códigos de error del BFF:
- 401 missing_token / invalid_header: sin header Authorization o con un esquema distinto de Bearer
- 401 invalid_signature: firma no corresponde a las claves del tenant
- 401 token_expired: exp vencido
- 401 invalid_iss / invalid_aud: emisor o audiencia incorrectos
- 403 insufficient_scope: falta access_as_user
- 403 forbidden_role: falta el App role requerido

## 7. Resultados verificados en local

| Prueba | Resultado |
|---|---|
| Entrar a /portal sin sesión | Redirige al login de Microsoft con PKCE (code_challenge_method=S256) |
| GET /me con token v2 | 200 con oid, tid, nombre, scope access_as_user |
| GET /documents sin roles | 403 forbidden_role "Se requiere uno de los roles: User, Admin" |
| GET /admin/audit sin roles | 403 forbidden_role "Se requiere uno de los roles: Admin" |
| Llamar al BFF sin token (curl) | 401 con WWW-Authenticate: Bearer error="invalid_token" |
| Pruebas automatizadas | 33 pruebas pasan (npx jest) |

## 8. Extra de seguridad: verificación en dos pasos (2FA/TOTP)

Además de Entra ID, la app mantiene el login propio con Supabase y tiene 2FA con app autenticadora (Supabase MFA, factor TOTP). Corregimos un hueco: el 2FA solo se exigía en las páginas y las rutas /api aceptaban una sesión AAL1 (solo contraseña). Ahora isMfaPending() (src/lib/supabase/mfa.ts) bloquea los datos si el usuario tiene un factor verificado y la sesión no está en AAL2. Los factores se leen del usuario validado por getUser() y no de la cookie, que el cliente puede manipular. Si no se puede determinar el nivel, se bloquea por defecto (fail-closed).

## 9. Variables de entorno

Frontend (se incrustan en el build, por eso van en GitHub Actions):
- NEXT_PUBLIC_ENTRA_TENANT_ID = tenant ID
- NEXT_PUBLIC_ENTRA_CLIENT_ID = client ID de la SPA
- NEXT_PUBLIC_ENTRA_API_SCOPE = api://<API client ID>/access_as_user
- NEXT_PUBLIC_BFF_BASE_URL = /api/bff/v1, o la URL de API Management

Backend (en App Service → Variables de entorno):
- ENTRA_TENANT_ID = tenant ID
- ENTRA_API_CLIENT_ID = client ID de la App API
- ENTRA_REQUIRED_SCOPE = access_as_user (opcional)

## 10. Pendientes para cerrar la EP1

1. Asignar roles Admin y User (y crear un usuario de prueba con rol User para mostrar el 403).
2. Cargar las variables en GitHub (Actions → Variables) y en el App Service; luego hacer push a main para desplegar.
3. Crear Azure API Management (plan Consumo), API "securevault" versionada /v1, operaciones GET /me, /documents, /admin/audit, aplicar apim-policy.xml y apuntar NEXT_PUBLIC_BFF_BASE_URL al gateway.
4. Preparar la presentación.

## 11. Guion para la demo y preguntas probables

Demo:
1. Abrir /login → "Continuar con Microsoft" → login en Entra ID.
2. En /portal mostrar roles y scopes leídos del token.
3. GET /me → 200; GET /admin/audit con rol User → 403; con rol Admin → 200.
4. curl sin token → 401. Mostrar la política validate-jwt de API Management.
5. Mostrar jwt.ts y las pruebas automatizadas.

Preguntas probables:
- ¿Por qué PKCE y no client secret? Porque una SPA corre en el navegador y no puede guardar secretos; PKCE protege el canje del código.
- ¿Dónde se valida la firma? En el BFF, con las claves públicas del tenant (JWKS) y RS256. También en API Management con validate-jwt.
- ¿Por qué validar en el gateway y en el BFF? Defensa en profundidad: si alguien llega directo al App Service saltándose el gateway, el BFF igual rechaza el token.
- ¿Qué diferencia hay entre scp y roles? scp son permisos delegados que la app pide en nombre del usuario; roles son permisos asignados al usuario por un administrador (RBAC).
- ¿Por qué el portal decodifica el token sin validarlo? Solo para mostrar información; la decisión de seguridad la toma siempre el backend.
- ¿Qué pasa cuando el token expira? MSAL lo renueva en silencio con el refresh token; si no puede, pide login interactivo.
- ¿Diferencia entre 401 y 403? 401 significa que no se sabe quién eres (token ausente o inválido); 403 significa que se sabe quién eres pero no tienes permiso.
