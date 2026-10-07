import type { SupabaseClient, User } from '@supabase/supabase-js'

/**
 * ¿La sesión tiene el 2FA pendiente?
 *
 * true si el usuario tiene un factor TOTP verificado pero la sesión aún está
 * en AAL1 (solo password). En ese caso la sesión NO debe tener acceso a datos.
 *
 * `user` debe venir de `supabase.auth.getUser()` (validado contra Supabase):
 * los factores se leen de ahí y no de la cookie, que es manipulable por el cliente.
 * El nivel actual (claim `aal`) sale del access token ya validado por getUser().
 * Ante cualquier duda (sin datos de AAL) se considera pendiente (fail-closed).
 */
export async function isMfaPending(supabase: SupabaseClient, user: User): Promise<boolean> {
  const hasVerifiedFactor = (user.factors ?? []).some((f) => f.status === 'verified')
  if (!hasVerifiedFactor) return false

  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  return data?.currentLevel !== 'aal2'
}
