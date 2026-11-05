import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

afterEach(() => vi.unstubAllEnvs())
import { probeEdgeBridgeHealth } from './managed-edge-health'

const TOKEN = 'x'.repeat(48)
const validReply = () =>
  new Response(
    JSON.stringify({ ok: true, latest_seq: 55, generation: 'a'.repeat(32) }),
    { status: 200, headers: { 'Content-Length': '79' } }
  )

describe('read-only Edge feed health (no execution privileges)', () => {
  it('fails closed without a token or on non-Windows', async () => {
    const get = vi.fn()
    expect(await probeEdgeBridgeHealth({
      platform: 'linux', getToken: () => TOKEN, get: get as unknown as typeof fetch
    })).toMatchObject({ status: 'NOT_CONFIGURED', error_code: 'WINDOWS_ONLY' })
    expect(await probeEdgeBridgeHealth({
      platform: 'win32', getToken: () => '', get: get as unknown as typeof fetch
    })).toMatchObject({ status: 'NOT_CONFIGURED', error_code: 'LOCAL_FEED_TOKEN_MISSING' })
    expect(get).not.toHaveBeenCalled()
  })

  it('probes only hardcoded loopback; response omits bearer and generation', async () => {
    const get = vi.fn(async (_url: string, _init: RequestInit) => validReply())
    const res = await probeEdgeBridgeHealth({
      platform: 'win32', getToken: () => TOKEN, get: get as unknown as typeof fetch
    })
    expect(res).toEqual({ status: 'ONLINE', port: 8768, latest_seq: 55 })
    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0][0]).toBe('http://127.0.0.1:8768/v2/health')
    expect(JSON.stringify(res)).not.toContain(TOKEN)
  })

  it('uses opt-in QA 8769 only; default remains production 8768', async () => {
    const get = vi.fn(async (_url: string, _init: RequestInit) => validReply())
    const qa = await probeEdgeBridgeHealth({
      platform: 'win32', qaMode: true, getToken: () => TOKEN,
      get: get as unknown as typeof fetch
    })
    expect(qa).toEqual({ status: 'ONLINE', port: 8769, latest_seq: 55 })
    expect(get.mock.calls[0][0]).toBe('http://127.0.0.1:8769/v2/health')
    const stable = await probeEdgeBridgeHealth({
      platform: 'win32', qaMode: false, getToken: () => TOKEN,
      get: get as unknown as typeof fetch
    })
    expect(stable.port).toBe(8768)
    expect(get.mock.calls[1][0]).toBe('http://127.0.0.1:8768/v2/health')
    expect(JSON.stringify(qa)).not.toContain(TOKEN)
  })

  it('uses the isolated 8770 token, never reusing production or 8769 credentials', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orcastrator-feed-qa-'))
    try {
      const base = join(root, 'Orcastrator', 'bridge')
      const stable = join(base, 'edge-chat-bridge')
      const qa8769 = join(base, 'edge-chat-bridge-qa-8769')
      const qa8770 = join(base, 'edge-chat-bridge-qa-8770')
      for (const dir of [stable, qa8769, qa8770]) mkdirSync(dir, { recursive: true })
      writeFileSync(join(stable, 'token.txt'), 'p'.repeat(48))
      writeFileSync(join(qa8769, 'token.txt'), 'n'.repeat(48))
      writeFileSync(join(qa8770, 'token.txt'), 'q'.repeat(48))
      vi.stubEnv('LOCALAPPDATA', root)
      vi.stubEnv('ORCA_E2E_HEADLESS', '0')

      const get = vi.fn(async (_url: string, _init: RequestInit) => validReply())
      vi.stubEnv('ORCA_EDGE_QA_PORT', '8770')
      const qa = await probeEdgeBridgeHealth({
        platform: 'win32', qaMode: true, get: get as unknown as typeof fetch
      })
      expect(qa).toEqual({ status: 'ONLINE', port: 8770, latest_seq: 55 })
      expect(get.mock.calls[0][0]).toBe('http://127.0.0.1:8770/v2/health')
      expect(new Headers(get.mock.calls[0][1].headers).get('Authorization'))
        .toBe('Bearer ' + 'q'.repeat(48))

      vi.stubEnv('ORCA_EDGE_QA_PORT', '8769')
      const legacyQa = await probeEdgeBridgeHealth({
        platform: 'win32', qaMode: true, get: get as unknown as typeof fetch
      })
      expect(legacyQa.port).toBe(8769)
      expect(new Headers(get.mock.calls[1][1].headers).get('Authorization'))
        .toBe('Bearer ' + 'n'.repeat(48))

      const prod = await probeEdgeBridgeHealth({
        platform: 'win32', qaMode: false, get: get as unknown as typeof fetch
      })
      expect(prod.port).toBe(8768)
      expect(new Headers(get.mock.calls[2][1].headers).get('Authorization'))
        .toBe('Bearer ' + 'p'.repeat(48))

      // Missing QA token fails closed even though the production token exists.
      rmSync(join(qa8770, 'token.txt'))
      vi.stubEnv('ORCA_EDGE_QA_PORT', '8770')
      const missing = await probeEdgeBridgeHealth({
        platform: 'win32', qaMode: true, get: get as unknown as typeof fetch
      })
      expect(missing).toEqual({
        status: 'NOT_CONFIGURED', port: 8770, error_code: 'LOCAL_FEED_TOKEN_MISSING'
      })
      expect(get).toHaveBeenCalledTimes(3)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects an unapproved QA port instead of connecting elsewhere', async () => {
    vi.stubEnv('ORCA_EDGE_QA_PORT', '8771')
    const get = vi.fn()
    const result = await probeEdgeBridgeHealth({
      platform: 'win32', qaMode: true, getToken: () => TOKEN,
      get: get as unknown as typeof fetch
    })
    expect(result).toEqual({
      status: 'NOT_CONFIGURED', port: 8769, error_code: 'INVALID_QA_PORT'
    })
    expect(get).not.toHaveBeenCalled()
  })

  it('does not read an ambient production token while running headless E2E', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-edge-token-test-'))
    try {
      const ambientRoot = join(root, 'ambient')
      const tokenDir = join(ambientRoot, 'Orcastrator', 'bridge', 'edge-chat-bridge')
      mkdirSync(tokenDir, { recursive: true })
      writeFileSync(join(tokenDir, 'token.txt'), TOKEN, 'utf8')
      vi.stubEnv('LOCALAPPDATA', ambientRoot)
      vi.stubEnv('ORCA_E2E_HEADLESS', '1')
      vi.stubEnv('ORCA_E2E_HOME_DIR', join(root, 'isolated-home'))

      const get = vi.fn(async (_url: string, _init: RequestInit) => validReply())
      const result = await probeEdgeBridgeHealth({
        platform: 'win32', qaMode: true, get: get as unknown as typeof fetch
      })
      expect(result).toEqual({
        status: 'NOT_CONFIGURED', port: 8769, error_code: 'LOCAL_FEED_TOKEN_MISSING'
      })
      expect(get).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('allows an ephemeral loopback port only in a headless isolated QA profile', async () => {
    const get = vi.fn(async (_url: string, _init: RequestInit) => validReply())
    vi.stubEnv('ORCA_E2E_HEADLESS', '1')
    vi.stubEnv('ORCA_E2E_HOME_DIR', 'C:\\isolated-e2e-home')
    vi.stubEnv('ORCA_EDGE_E2E_PORT', '49321')
    const e2e = await probeEdgeBridgeHealth({
      platform: 'win32', qaMode: true, getToken: () => TOKEN,
      get: get as unknown as typeof fetch
    })
    expect(e2e).toEqual({ status: 'ONLINE', port: 49321, latest_seq: 55 })
    expect(get.mock.calls[0][0]).toBe('http://127.0.0.1:49321/v2/health')

    // The same environment variable must NEVER redirect an ordinary Desktop session.
    vi.stubEnv('ORCA_E2E_HEADLESS', '0')
    const normal = await probeEdgeBridgeHealth({
      platform: 'win32', qaMode: true, getToken: () => TOKEN,
      get: get as unknown as typeof fetch
    })
    expect(normal.port).toBe(8769)
    expect(get.mock.calls[1][0]).toBe('http://127.0.0.1:8769/v2/health')

    vi.stubEnv('ORCA_E2E_HEADLESS', '1')
    vi.stubEnv('ORCA_EDGE_E2E_PORT', 'not-a-port')
    const invalid = await probeEdgeBridgeHealth({
      platform: 'win32', qaMode: true, getToken: () => TOKEN,
      get: get as unknown as typeof fetch
    })
    expect(invalid).toEqual({
      status: 'NOT_CONFIGURED', port: 8769, error_code: 'INVALID_E2E_PORT'
    })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed bearer tokens before making any network request', async () => {
    const get = vi.fn()
    const result = await probeEdgeBridgeHealth({
      platform: 'win32', getToken: () => 'x'.repeat(47) + ':',
      get: get as unknown as typeof fetch
    })
    expect(result).toEqual({
      status: 'NOT_CONFIGURED', port: 8768,
      error_code: 'LOCAL_FEED_TOKEN_MISSING'
    })
    expect(get).not.toHaveBeenCalled()
  })

  it('bounds the HTTP health response even with missing or false content-length', async () => {
    const bigPayload = 'x'.repeat(3000)
    const replies = [
      new Response(bigPayload, { status: 200 }),
      new Response(bigPayload, {
        status: 200, headers: { 'Content-Length': '10' }
      }),
      new Response('{}', {
        status: 200, headers: { 'Content-Length': 'not-a-number' }
      })
    ]
    for (const response of replies) {
      const state = await probeEdgeBridgeHealth({
        platform: 'win32', getToken: () => TOKEN,
        get: (async () => response) as typeof fetch
      })
      expect(state).toEqual({
        status: 'ERROR', port: 8768,
        error_code: 'FEED_RESPONSE_TOO_LARGE'
      })
      expect(JSON.stringify(state)).not.toContain(TOKEN)
    }
  })

  it('does not treat no-auth, v1, offline, or malformed feeds as healthy', async () => {
    const cases: Array<{ response: Response; expected: string }> = [
      { response: new Response('{}', { status: 401 }), expected: 'ERROR' },
      { response: new Response('{}', { status: 404 }), expected: 'LEGACY' },
      { response: new Response('{"ok":true,"latest_seq":"x"}'), expected: 'ERROR' },
      { response: new Response('bad-json'), expected: 'ERROR' }
    ]
    for (const item of cases) {
      const state = await probeEdgeBridgeHealth({
        platform: 'win32',
        getToken: () => TOKEN,
        get: (async () => item.response) as typeof fetch
      })
      expect(state.status).toBe(item.expected)
    }
    const network = await probeEdgeBridgeHealth({
      platform: 'win32',
      getToken: () => TOKEN,
      get: (async () => { throw new Error('network') }) as typeof fetch
    })
    expect(network.status).toBe('OFFLINE')
  })
})
