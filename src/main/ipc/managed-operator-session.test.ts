import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureOperatorSession, resolveOperatorToken } from './managed-operator-session'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('managed operator authentication E2E isolation', () => {
  it('fails closed without resolving host credentials or sending HTTP in headless E2E', async () => {
    vi.stubEnv('ORCA_E2E_HEADLESS', '1')
    vi.stubEnv('ORCA_E2E_HOME_DIR', 'C:\\synthetic-isolated-home')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    expect(resolveOperatorToken()).toBeNull()
    const session = await ensureOperatorSession()
    expect(session).toEqual({
      ok: false,
      error: 'Operator authentication disabled in headless E2E.'
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed even if inherited environment advertises a managed token', async () => {
    vi.stubEnv('ORCA_E2E_HEADLESS', '1')
    vi.stubEnv('MANAGED_BRIDGE_TOKEN', 'synthetic-bridge-only')
    vi.stubEnv('ORCHESTRATOR_ENV', 'STAGING_LOCAL')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    expect(resolveOperatorToken()).toBeNull()
    expect((await ensureOperatorSession(true)).ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
