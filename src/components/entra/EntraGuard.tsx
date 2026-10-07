'use client'

import { MsalAuthenticationTemplate } from '@azure/msal-react'
import { InteractionType } from '@azure/msal-browser'
import { Loader2 } from 'lucide-react'
import { loginRequest } from '@/lib/entra/msal-config'

/**
 * Guard de rutas (equivalente a MsalGuard de Angular): si no hay sesión de
 * Entra ID, inicia el login por redirect antes de renderizar el contenido.
 */
export function EntraGuard({ children }: { children: React.ReactNode }) {
  return (
    <MsalAuthenticationTemplate
      interactionType={InteractionType.Redirect}
      authenticationRequest={loginRequest}
      loadingComponent={() => (
        <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Redirigiendo a Microsoft…
        </div>
      )}
      errorComponent={({ error }) => (
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <p className="text-sm text-destructive text-center">
            No se pudo iniciar sesión con Microsoft: {error?.errorMessage ?? 'error desconocido'}
          </p>
        </div>
      )}
    >
      {children}
    </MsalAuthenticationTemplate>
  )
}
