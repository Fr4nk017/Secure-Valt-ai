/**
 * @jest-environment node
 */
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { isMfaPending } from '@/lib/supabase/mfa'

function mockSupabase(currentLevel: string | null) {
  return {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: jest.fn().mockResolvedValue({
          data: currentLevel ? { currentLevel, nextLevel: 'aal2' } : null,
          error: null,
        }),
      },
    },
  } as unknown as SupabaseClient
}

const userWith = (factors: Array<{ status: string }> | undefined) => ({ id: 'u1', factors }) as unknown as User

describe('isMfaPending', () => {
  it('false si el usuario no tiene factores verificados', async () => {
    const supabase = mockSupabase('aal1')
    expect(await isMfaPending(supabase, userWith(undefined))).toBe(false)
    expect(await isMfaPending(supabase, userWith([{ status: 'unverified' }]))).toBe(false)
  })

  it('true si tiene 2FA y la sesión está en AAL1', async () => {
    expect(await isMfaPending(mockSupabase('aal1'), userWith([{ status: 'verified' }]))).toBe(true)
  })

  it('false si tiene 2FA y la sesión ya está en AAL2', async () => {
    expect(await isMfaPending(mockSupabase('aal2'), userWith([{ status: 'verified' }]))).toBe(false)
  })

  it('fail-closed: true si no se puede determinar el AAL', async () => {
    expect(await isMfaPending(mockSupabase(null), userWith([{ status: 'verified' }]))).toBe(true)
  })
})
