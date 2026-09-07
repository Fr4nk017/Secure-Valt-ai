/**
 * Supabase Admin Client (Service Role)
 *
 * Usar ÚNICAMENTE en el servidor (API routes, Server Actions).
 * NUNCA exponer al cliente — tiene permisos de superadmin.
 *
 * Usado para:
 * - Supabase Storage (subida de archivos sin restricciones de RLS)
 * - Operaciones admin de Auth (crear/eliminar usuarios)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

function getSupabaseAdmin(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-role-key-for-build'
    _client = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }
  return _client
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin()
    const val = (client as any)[prop]
    return typeof val === 'function' ? val.bind(client) : val
  },
})
