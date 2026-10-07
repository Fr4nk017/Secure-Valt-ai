'use client'

import { useEffect, useState } from 'react'
import {
  EventType,
  PublicClientApplication,
  type AuthenticationResult,
  type EventMessage,
} from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import { Loader2 } from 'lucide-react'
import { buildMsalConfig, isEntraConfigured } from '@/lib/entra/msal-config'

/**
 * Inicializa MSAL (solo en el navegador) y expone la instancia vía MsalProvider.
 * Tras un login exitoso fija la cuenta activa para que el interceptor la use.
 */
export function EntraProvider({ children }: { children: React.ReactNode }) {
  const [instance, setInstance] = useState<PublicClientApplication | null>(null)

  useEffect(() => {
    if (!isEntraConfigured) return
    const pca = new PublicClientApplication(buildMsalConfig(window.location.origin))
    pca.initialize().then(() => {
      if (!pca.getActiveAccount() && pca.getAllAccounts().length > 0) {
        pca.setActiveAccount(pca.getAllAccounts()[0])
      }
      pca.addEventCallback((event: EventMessage) => {
        if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
          pca.setActiveAccount((event.payload as AuthenticationResult).account)
        }
      })
      setInstance(pca)
    })
  }, [])

  if (!isEntraConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground max-w-md text-center">
          El inicio de sesión con Microsoft Entra ID no está configurado. Define
          NEXT_PUBLIC_ENTRA_TENANT_ID, NEXT_PUBLIC_ENTRA_CLIENT_ID y NEXT_PUBLIC_ENTRA_API_SCOPE.
        </p>
      </div>
    )
  }

  if (!instance) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  return <MsalProvider instance={instance}>{children}</MsalProvider>
}
