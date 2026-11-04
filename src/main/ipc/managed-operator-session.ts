import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveProfileAndToken } from './managed-resolver'

type SessionState = {
  sessionCookie: string | null
  csrfToken: string | null
  authenticated: boolean
  lastAuthTime: number
}

const state: SessionState = {
  sessionCookie: null,
  csrfToken: null,
  authenticated: false,
  lastAuthTime: 0
}

// In-flight / recent action guard for replay/duplicate prevention
const recentActions = new Set<string>()

export function checkAndMarkAction(actionKey: string, ttlMs = 3000): boolean {
  if (recentActions.has(actionKey)) {
    return false // Duplicate / replay blocked
  }
  recentActions.add(actionKey)
  setTimeout(() => recentActions.delete(actionKey), ttlMs)
  return true
}

export function resolveOperatorToken(): string | null {
  // E2E HOME isolation does not change process.cwd(); walking ancestor paths
  // could read an actual operator token from a separate host worktree.
  // Headless E2E may exercise read-only synthetic RPC, never host operator auth.
  if (process.env.ORCA_E2E_HEADLESS === '1') return null
  const config = resolveProfileAndToken()
  const targetFile =
    config.profile === 'STAGING_LOCAL' ? '.operator_token_staging' : '.operator_token'
  const subDirs =
    config.profile === 'STAGING_LOCAL'
      ? [
          'workspaces/staging',
          'ORQUESTADOR-MASTER/workspaces/staging',
          'Chat-AGY-CODEX-Orquestador/workspaces/staging',
          ''
        ]
      : ['', 'ORQUESTADOR-MASTER', 'Chat-AGY-CODEX-Orquestador']

  let dir = process.cwd()
  for (let i = 0; i < 4; i++) {
    for (const sub of subDirs) {
      const full = resolve(dir, sub, targetFile)
      if (existsSync(full)) {
        try {
          const content = readFileSync(full, 'utf8').trim()
          if (content) {
            return content
          }
        } catch {
          // ignore
        }
      }
    }
    const parent = resolve(dir, '..')
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return null
}

export async function ensureOperatorSession(
  forceRefresh = false
): Promise<{ ok: boolean; sessionCookie?: string; csrfToken?: string; error?: string }> {
  // Reject before even consulting a cached session or inspecting token paths.
  // In a disposable E2E run operator REST calls must not escape the fixture.
  if (process.env.ORCA_E2E_HEADLESS === '1') {
    return { ok: false, error: 'Operator authentication disabled in headless E2E.' }
  }
  const now = Date.now()
  if (
    !forceRefresh &&
    state.authenticated &&
    state.sessionCookie &&
    state.csrfToken &&
    now - state.lastAuthTime < 3600_000 // 1 hour valid
  ) {
    return { ok: true, sessionCookie: state.sessionCookie, csrfToken: state.csrfToken }
  }

  const token = resolveOperatorToken()
  if (!token) {
    return {
      ok: false,
      error: 'Token de operador efímero (.operator_token) no encontrado en el host local.'
    }
  }

  const config = resolveProfileAndToken()
  const baseUrl = `http://127.0.0.1:${config.port}`

  try {
    // 1. Obtain initial session & csrf token
    const csrfResp = await fetch(`${baseUrl}/api/csrf-token`)
    const setCookie = csrfResp.headers.get('set-cookie')
    let sessionCookie = ''
    if (setCookie) {
      const match = setCookie.match(/orchestrator_session=([^;]+)/)
      if (match) {
        sessionCookie = `orchestrator_session=${match[1]}`
      }
    }
    const csrfData = (await csrfResp.json().catch(() => ({}))) as { csrf_token?: string }

    // 2. Unlock session with operator token
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (sessionCookie) {
      headers['Cookie'] = sessionCookie
    }

    const unlockResp = await fetch(`${baseUrl}/api/auth/unlock`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ token })
    })

    if (!unlockResp.ok) {
      const errJson = (await unlockResp.json().catch(() => ({}))) as { detail?: string }
      return { ok: false, error: errJson.detail || 'Fallo de autenticación con token de operador.' }
    }

    const unlockData = (await unlockResp.json().catch(() => ({}))) as {
      status?: string
      csrf_token?: string
    }
    const unlockCookie = unlockResp.headers.get('set-cookie')
    if (unlockCookie) {
      const match = unlockCookie.match(/orchestrator_session=([^;]+)/)
      if (match) {
        sessionCookie = `orchestrator_session=${match[1]}`
      }
    }

    const csrfToken = unlockData.csrf_token || csrfData.csrf_token
    if (!sessionCookie || !csrfToken) {
      state.authenticated = false
      state.sessionCookie = null
      state.csrfToken = null
      return { ok: false, error: 'Sesión de operador sin cookie o CSRF verificado.' }
    }
    state.sessionCookie = sessionCookie
    state.csrfToken = csrfToken
    state.authenticated = true
    state.lastAuthTime = now

    return { ok: true, sessionCookie, csrfToken }
  } catch (err: unknown) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : 'Error de conexión con el motor para autenticación'
    }
  }
}

export async function callOperatorEndpoint(
  path: string,
  method = 'POST',
  body?: unknown
): Promise<{ ok: boolean; status: number; data?: Record<string, unknown>; error?: string }> {
  const sessionRes = await ensureOperatorSession()
  if (!sessionRes.ok || !sessionRes.sessionCookie || !sessionRes.csrfToken) {
    return {
      ok: false,
      status: 401,
      error: sessionRes.error || 'Autenticación de operador no disponible.'
    }
  }

  const config = resolveProfileAndToken()
  const url = `http://127.0.0.1:${config.port}${path}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Cookie: sessionRes.sessionCookie,
    'X-CSRF-Token': sessionRes.csrfToken
  }

  try {
    const hasBody = body !== undefined && method !== 'GET'
    let resp = await fetch(url, {
      method,
      headers,
      ...(hasBody ? { body: JSON.stringify(body) } : {})
    })

    if (resp.status === 401 || resp.status === 403) {
      // Session may have expired; retry once with force refresh
      const refreshed = await ensureOperatorSession(true)
      if (refreshed.ok && refreshed.sessionCookie && refreshed.csrfToken) {
        headers['Cookie'] = refreshed.sessionCookie
        headers['X-CSRF-Token'] = refreshed.csrfToken
        resp = await fetch(url, {
          method,
          headers,
          ...(hasBody ? { body: JSON.stringify(body) } : {})
        })
      }
    }

    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>
    return {
      ok: resp.ok,
      status: resp.status,
      data: json,
      error: !resp.ok ? String(json.detail || json.message || resp.statusText) : undefined
    }
  } catch (err: unknown) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
