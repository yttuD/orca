import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Safe, read-only visibility into the WCB/Edge loopback feed.
 * Never exposes a bearer token or runs/starts any worker.
 * A healthy feed is NOT proof that a browser received a message.
 */
export type EdgeBridgeHealth = {
  readonly status: 'ONLINE' | 'OFFLINE' | 'NOT_CONFIGURED' | 'LEGACY' | 'ERROR'
  readonly port: number
  readonly latest_seq?: number
  readonly error_code?: string
}

function readLocalFeedToken(port: number, syntheticE2E: boolean): string | null {
  // E2E must never read tokens from the operator's real LOCALAPPDATA.
  const root = process.env.ORCA_E2E_HEADLESS === '1'
    ? process.env.ORCA_E2E_HOME_DIR
      ? join(process.env.ORCA_E2E_HOME_DIR, 'AppData', 'Local')
      : null
    : process.env.LOCALAPPDATA
  if (!root) return null
  try {
    // The feed isolates credentials by port. Never fall back to the stable
    // 8768 token when the user opted into the 8769/8770 QA feed.
    // Synthetic E2E retains its own disposable HOME and fixture token path.
    const folder = syntheticE2E
      ? 'edge-chat-bridge'
      : port === 8768 ? 'edge-chat-bridge' : `edge-chat-bridge-qa-${port}`
    const path = join(root, 'Orcastrator', 'bridge', folder, 'token.txt')
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
  // An ephemeral port override is allowed ONLY in a disposable headless E2E home.
  // In ordinary Desktop mode the host/port remain the fixed allowlist: 8768/8769/8770.
  const e2eIsolated =
    qaMode && process.env.ORCA_E2E_HEADLESS === '1' &&
    Boolean(process.env.ORCA_E2E_HOME_DIR)
  const requestedQaPort = qaMode ? process.env.ORCA_EDGE_QA_PORT : undefined
  const qaPort = requestedQaPort === '8770' ? 8770 : 8769
  const rawTestPort = e2eIsolated ? process.env.ORCA_EDGE_E2E_PORT : undefined
  const parsedTestPort =
    rawTestPort && /^[1-9][0-9]{3,4}$/.test(rawTestPort) ? Number(rawTestPort) : NaN
  const validTestPort = Number.isInteger(parsedTestPort) &&
    parsedTestPort >= 1024 && parsedTestPort <= 65535
  const port: number = e2eIsolated && validTestPort
    ? parsedTestPort
    : qaMode ? qaPort : 8768
  if (requestedQaPort && requestedQaPort !== '8769' && requestedQaPort !== '8770') {
    return { status: 'NOT_CONFIGURED', port, error_code: 'INVALID_QA_PORT' }
  }
  if (rawTestPort && !validTestPort) {
    return { status: 'NOT_CONFIGURED', port, error_code: 'INVALID_E2E_PORT' }
  }
  if ((deps.platform ?? process.platform) !== 'win32') {
    return { status: 'NOT_CONFIGURED', port, error_code: 'WINDOWS_ONLY' }
  }
  const token = deps.getToken
    ? deps.getToken()
    : readLocalFeedToken(port, e2eIsolated && validTestPort)
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
