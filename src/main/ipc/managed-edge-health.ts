import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Safe, read-only visibility into the WCB/Edge loopback feed.
 * Never exposes a bearer token or runs/starts any worker.
 * A healthy feed is NOT proof that a browser received a message.
 */
export type EdgeBridgeHealth = {
  readonly status: 'ONLINE' | 'OFFLINE' | 'NOT_CONFIGURED' | 'LEGACY' | 'ERROR'
  readonly port: 8768 | 8769
  readonly latest_seq?: number
  readonly error_code?: string
}

function readLocalFeedToken(): string | null {
  const root = process.env.LOCALAPPDATA
  if (!root) return null
  try {
    const path = join(root, 'Orcastrator', 'bridge', 'edge-chat-bridge', 'token.txt')
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256) return null
    const token = readFileSync(path, 'utf8').trim()
    return token.length >= 40 && token.length <= 128 ? token : null
  } catch {
    return null
  }
}

export async function probeEdgeBridgeHealth(
  deps: {
    platform?: string
    qaMode?: boolean
    getToken?: () => string | null
    get?: typeof fetch
  } = {}
): Promise<EdgeBridgeHealth> {
  // Only a test-profile opt-in may use the isolated v0.2 feed.
  const qaMode = deps.qaMode ?? process.env.ORCA_EDGE_QA_MODE === '1'
  const port: 8768 | 8769 = qaMode ? 8769 : 8768
  if ((deps.platform ?? process.platform) !== 'win32') {
    return { status: 'NOT_CONFIGURED', port, error_code: 'WINDOWS_ONLY' }
  }
  const token = (deps.getToken ?? readLocalFeedToken)()
  if (!token || token.length < 40 || token.length > 128) {
    return { status: 'NOT_CONFIGURED', port, error_code: 'LOCAL_FEED_TOKEN_MISSING' }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 2000)
  try {
    const res = await (deps.get ?? fetch)(`http://127.0.0.1:${port}/v2/health`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    })
    if (res.status === 404) return { status: 'LEGACY', port }
    if (res.status === 401 || res.status === 403) {
      return { status: 'ERROR', port, error_code: 'FEED_AUTH_REJECTED' }
    }
    if (!res.ok) return { status: 'ERROR', port, error_code: 'FEED_UNAVAILABLE' }
    if (Number(res.headers.get('content-length') || 0) > 2048) {
      return { status: 'ERROR', port, error_code: 'FEED_RESPONSE_TOO_LARGE' }
    }
    let payload: unknown
    try {
      payload = await res.json()
    } catch {
      return { status: 'ERROR', port, error_code: 'FEED_INVALID_JSON' }
    }
    if (!payload || typeof payload !== 'object') {
      return { status: 'ERROR', port, error_code: 'FEED_INVALID_RESPONSE' }
    }
    const record = payload as Record<string, unknown>
    if (
      record.ok !== true ||
      !Number.isSafeInteger(record.latest_seq) ||
      (record.latest_seq as number) < 0 ||
      typeof record.generation !== 'string' ||
      !/^[a-f0-9]{32}$/.test(record.generation)
    ) {
      return { status: 'ERROR', port, error_code: 'FEED_INVALID_RESPONSE' }
    }
    return { status: 'ONLINE', port, latest_seq: record.latest_seq as number }
  } catch {
    return { status: 'OFFLINE', port, error_code: 'FEED_NOT_REACHABLE' }
  } finally {
    clearTimeout(timer)
  }
}
