import { describe, expect, it, vi } from 'vitest'
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
