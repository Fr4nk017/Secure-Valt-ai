import type { Metadata } from 'next'
import { EntraProvider } from '@/components/entra/EntraProvider'
import { EntraGuard } from '@/components/entra/EntraGuard'

export const metadata: Metadata = { title: 'Portal Entra ID' }

/**
 * Portal corporativo autenticado con Microsoft Entra ID (MSAL).
 * Todas las rutas bajo /portal pasan por el guard de MSAL.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <EntraProvider>
      <EntraGuard>{children}</EntraGuard>
    </EntraProvider>
  )
}
