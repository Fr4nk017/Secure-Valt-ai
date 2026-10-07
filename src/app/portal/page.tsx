'use client'

import { useEffect, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { ShieldCheck, LogOut, Loader2, KeyRound, Users } from 'lucide-react'
import { acquireApiToken, bffFetch, decodeJwtPayload } from '@/lib/entra/api-client'
import { apiScope, bffBaseUrl } from '@/lib/entra/msal-config'

interface AccessTokenClaims {
  aud?: string
  iss?: string
  exp?: number
  scp?: string
  roles?: string[]
}

interface CallResult {
  path: string
  status: number
  body: unknown
}

const ADMIN_ROLE = 'SecureVault.Admin'

const ENDPOINTS = [
  { path: '/me', label: 'Mi identidad', hint: 'Cualquier usuario autenticado' },
  { path: '/documents', label: 'Documentos', hint: 'Rol SecureVault.User o Admin' },
  { path: '/admin/audit', label: 'Auditoría (admin)', hint: 'Solo rol SecureVault.Admin' },
]

export default function PortalPage() {
  const { instance, accounts } = useMsal()
  const account = instance.getActiveAccount() ?? accounts[0]

  const [claims, setClaims] = useState<AccessTokenClaims | null>(null)
  const [result, setResult] = useState<CallResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Leer roles y scopes desde los claims del access token
  useEffect(() => {
    acquireApiToken(instance, [apiScope])
      .then(({ accessToken }) => setClaims(decodeJwtPayload<AccessTokenClaims>(accessToken)))
      .catch(() => setClaims(null))
  }, [instance])

  const roles = claims?.roles ?? []
  const scopes = claims?.scp?.split(' ') ?? []
  const isAdmin = roles.includes(ADMIN_ROLE)

  async function call(path: string) {
    setBusy(path)
    try {
      const res = await bffFetch(instance, path)
      const body = await res.json().catch(() => null)
      setResult({ path, status: res.status, body })
    } catch (err) {
      setResult({ path, status: 0, body: { error: (err as Error).message } })
    } finally {
      setBusy(null)
    }
  }

  function signOut() {
    instance.logoutRedirect({ account })
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Portal corporativo</h1>
              <p className="text-xs text-muted-foreground">Autenticado con Microsoft Entra ID</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="px-3 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted inline-flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" /> Cerrar sesión
          </button>
        </header>

        {/* Identidad y claims del token */}
        <section className="bg-card rounded-xl border border-border p-6 shadow-card space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">Sesión iniciada como</p>
            <p className="text-lg font-semibold text-card-foreground">{account?.name}</p>
            <p className="text-sm text-muted-foreground">{account?.username}</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground flex items-center gap-1.5 mb-1.5"><Users className="w-4 h-4" /> Roles (claim roles)</p>
              <div className="flex flex-wrap gap-1.5">
                {roles.length ? roles.map((r) => (
                  <span key={r} className="px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">{r}</span>
                )) : <span className="text-xs text-muted-foreground">Sin roles asignados</span>}
              </div>
            </div>
            <div>
              <p className="text-muted-foreground flex items-center gap-1.5 mb-1.5"><KeyRound className="w-4 h-4" /> Scopes (claim scp)</p>
              <div className="flex flex-wrap gap-1.5">
                {scopes.map((s) => (
                  <span key={s} className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground border border-border">{s}</span>
                ))}
              </div>
            </div>
          </div>
          {claims?.exp && (
            <p className="text-xs text-muted-foreground">
              Token válido hasta {new Date(claims.exp * 1000).toLocaleTimeString()} · aud {claims.aud}
            </p>
          )}
        </section>

        {/* Llamadas al BFF */}
        <section className="bg-card rounded-xl border border-border p-6 shadow-card space-y-4">
          <div>
            <h2 className="font-bold text-card-foreground">API (BFF v1)</h2>
            <p className="text-xs text-muted-foreground break-all">{bffBaseUrl}</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {ENDPOINTS.map((e) => (
              <button
                key={e.path}
                onClick={() => call(e.path)}
                disabled={busy !== null}
                className="text-left p-3 rounded-lg border border-border hover:bg-muted disabled:opacity-60"
              >
                <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                  {busy === e.path && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  GET {e.path}
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5">{e.hint}</span>
              </button>
            ))}
          </div>

          {result && (
            <div className="space-y-2">
              <p className="text-sm">
                <span className="font-mono">GET {result.path}</span>{' '}
                <span className={`font-semibold ${result.status >= 200 && result.status < 300 ? 'text-success' : 'text-destructive'}`}>
                  {result.status || 'error'}
                </span>
              </p>
              <pre className="text-xs bg-muted/40 border border-border rounded-lg p-3 overflow-auto max-h-80">
                {JSON.stringify(result.body, null, 2)}
              </pre>
            </div>
          )}
        </section>

        {/* Sección visible solo para administradores (guard por rol en UI) */}
        {isAdmin && (
          <section className="bg-card rounded-xl border border-primary/30 p-6 shadow-card">
            <h2 className="font-bold text-card-foreground">Administración</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Visible porque tu token incluye el rol {ADMIN_ROLE}. El BFF vuelve a validar el rol en cada request.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
