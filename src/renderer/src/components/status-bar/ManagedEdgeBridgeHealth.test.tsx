import { describe, expect, it } from 'vitest'
import { feedHealthHint } from './ManagedEdgeBridgeHealth'

describe('Orcastrator Desktop feed diagnostics', () => {
  it('distinguishes missing credentials from local connection failures', () => {
    expect(feedHealthHint('LOCAL_FEED_TOKEN_MISSING')).toContain('Token local')
    expect(feedHealthHint('FEED_AUTH_REJECTED')).toContain('rechazada')
    expect(feedHealthHint('FEED_NOT_REACHABLE')).toContain('no responde')
  })

  it('surfaces the QA allowlist and size-bound failure modes', () => {
    expect(feedHealthHint('INVALID_QA_PORT')).toContain('QA')
    expect(feedHealthHint('FEED_RESPONSE_TOO_LARGE')).toContain('límite')
    expect(feedHealthHint('FEED_INVALID_JSON')).toBe(feedHealthHint('FEED_INVALID_RESPONSE'))
  })

  it('never renders raw server errors, paths, or tokens', () => {
    expect(feedHealthHint(undefined)).toBeNull()
    expect(feedHealthHint('Bearer secret-key-from-server')).toBeNull()
    expect(feedHealthHint('C:\\Users\\Someone\\AppData\\token.txt')).toBeNull()
  })
})
