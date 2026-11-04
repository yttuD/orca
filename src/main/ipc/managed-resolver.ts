import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ManagedProfileConfig } from './managed-types'

/**
 * Resolves the active operating profile and bridge token deterministically.
 * Eliminates pure mtime guessing in favor of explicit configuration and active profile descriptor.
 */
export function resolveProfileAndToken(): ManagedProfileConfig {
  let profile: 'NORMAL' | 'STAGING_LOCAL' = 'NORMAL'
  let port = 8765
  let token: string | null = null

  if (process.env.MANAGED_PROFILE) {
    const envProf = process.env.MANAGED_PROFILE.trim().toUpperCase()
    profile = envProf === 'STAGING' || envProf === 'STAGING_LOCAL' ? 'STAGING_LOCAL' : 'NORMAL'
  } else if (process.env.ORCHESTRATOR_ENV) {
    const envProf = process.env.ORCHESTRATOR_ENV.trim().toUpperCase()
    if (envProf === 'STAGING' || envProf === 'STAGING_LOCAL') {
      profile = 'STAGING_LOCAL'
    }
  }

  if (process.env.MANAGED_PORT && Number(process.env.MANAGED_PORT)) {
    port = Number(process.env.MANAGED_PORT)
  }

  // In a hidden E2E run with a complete explicit Managed config, never scan
  // the host cwd/ancestors for .active_profile or protected token files.
  // The test endpoint and credentials are supplied by its own fixture.
  if (
    process.env.ORCA_E2E_HEADLESS === '1' &&
    process.env.MANAGED_PROFILE &&
    process.env.MANAGED_PORT &&
    process.env.MANAGED_BRIDGE_TOKEN
  ) {
    token = process.env.MANAGED_BRIDGE_TOKEN.trim() || null
    return { profile, port, token, engineUrl: `http://127.0.0.1:${port}/api/managed/rpc` }
  }

  // Check for unambiguous .active_profile JSON descriptor
  let currentDir = process.cwd()
  let activeProfileMetadata: Record<string, unknown> | null = null

  if (
    process.env.MANAGED_ACTIVE_PROFILE_PATH &&
    existsSync(process.env.MANAGED_ACTIVE_PROFILE_PATH)
  ) {
    try {
      const parsed = JSON.parse(readFileSync(process.env.MANAGED_ACTIVE_PROFILE_PATH, 'utf8'))
      if (parsed && typeof parsed.profile === 'string') {
        activeProfileMetadata = parsed
      }
    } catch {
      // ignore
    }
  }

  for (let i = 0; i < 4 && !activeProfileMetadata; i++) {
    const candidatePaths = [
      resolve(currentDir, '.active_profile'),
      resolve(currentDir, 'workspaces', 'staging', '.active_profile'),
      resolve(currentDir, 'ORQUESTADOR-MASTER', '.active_profile'),
      resolve(currentDir, 'ORQUESTADOR-MASTER', 'workspaces', 'staging', '.active_profile'),
      resolve(currentDir, 'Chat-AGY-CODEX-Orquestador', '.active_profile'),
      resolve(currentDir, 'Chat-AGY-CODEX-Orquestador', 'workspaces', 'staging', '.active_profile')
    ]
    for (const p of candidatePaths) {
      if (existsSync(p)) {
        try {
          const parsed = JSON.parse(readFileSync(p, 'utf8'))
          if (parsed && typeof parsed.profile === 'string') {
            activeProfileMetadata = parsed
            break
          }
        } catch {
          // ignore
        }
      }
    }
    if (activeProfileMetadata) {
      break
    }
    const parent = resolve(currentDir, '..')
    if (parent === currentDir) {
      break
    }
    currentDir = parent
  }

  if (activeProfileMetadata && !process.env.MANAGED_PROFILE) {
    const pStr = String(activeProfileMetadata.profile).toUpperCase()
    profile = pStr === 'STAGING' || pStr === 'STAGING_LOCAL' ? 'STAGING_LOCAL' : 'NORMAL'
    if (typeof activeProfileMetadata.port === 'number') {
      port = activeProfileMetadata.port
    }
  }

  if (process.env.MANAGED_BRIDGE_TOKEN) {
    token = process.env.MANAGED_BRIDGE_TOKEN.trim()
  } else if (
    process.env.MANAGED_BRIDGE_TOKEN_PATH &&
    existsSync(process.env.MANAGED_BRIDGE_TOKEN_PATH)
  ) {
    try {
      token = readFileSync(process.env.MANAGED_BRIDGE_TOKEN_PATH, 'utf8').trim() || null
    } catch {
      // ignore
    }
  }

  if (!token) {
    const targetFile =
      profile === 'STAGING_LOCAL' ? '.managed_bridge_token_staging' : '.managed_bridge_token'
    const subDirs =
      profile === 'STAGING_LOCAL'
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
              token = content
              break
            }
          } catch {
            // ignore
          }
        }
      }
      if (token) {
        break
      }
      const parent = resolve(dir, '..')
      if (parent === dir) {
        break
      }
      dir = parent
    }
  }

  const engineUrl = `http://127.0.0.1:${port}/api/managed/rpc`
  return { profile, port, token, engineUrl }
}

export function resolveBridgeToken(): string | null {
  return resolveProfileAndToken().token
}

export type ManagedCallerAuth = {
  surface?: 'renderer' | 'mobile'
  deviceId?: string
  deviceToken?: string
  nonce?: string
  timestamp?: number
  profile?: string
}

export async function callEngineRpc(
  method: string,
  params: Record<string, unknown> = {},
  callerAuth?: ManagedCallerAuth
): Promise<Record<string, unknown>> {
  const config = resolveProfileAndToken()
  const isMobile = callerAuth?.surface === 'mobile' || Boolean(callerAuth?.deviceId)
  const payload = {
    request_id: `req-orca-${Date.now()}-${randomBytes(4).toString('hex')}`,
    method,
    protocol: { name: 'managed', major: 1, minor: 0 },
    caller: {
      surface: isMobile ? 'mobile' : 'renderer',
      authenticated: Boolean(callerAuth?.deviceToken || config.token),
      capabilities: ['VIEW', 'EVIDENCE_READ'],
      deviceId: callerAuth?.deviceId
    },
    params
  }

  const profileHeader = callerAuth?.profile || config.profile
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Managed-Profile': profileHeader
  }

  if (isMobile) {
    if (callerAuth?.deviceToken) {
      headers['Authorization'] = `Bearer ${callerAuth.deviceToken}`
    }
    if (callerAuth?.deviceId) {
      headers['X-Managed-Device-Id'] = callerAuth.deviceId
    }
    if (callerAuth?.nonce) {
      headers['X-Managed-Nonce'] = callerAuth.nonce
    }
    if (callerAuth?.timestamp) {
      headers['X-Managed-Timestamp'] = String(callerAuth.timestamp)
    }
  } else if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2500)

  try {
    const resp = await fetch(config.engineUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    }).finally(() => clearTimeout(timeout))

    if (!resp.ok) {
      return {
        ok: false,
        error_code: `HTTP_${resp.status}`,
        error_message: `Engine HTTP error: ${resp.statusText}`
      }
    }
    return (await resp.json()) as Record<string, unknown>
  } catch (err: unknown) {
    clearTimeout(timeout)
    return {
      ok: false,
      error_code: 'ENGINE_OFFLINE',
      error_message: err instanceof Error ? err.message : 'Engine connection failed'
    }
  }
}

export async function callEngineRest(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): Promise<{ ok: boolean; status: number; data?: Record<string, unknown>; error?: string }> {
  const config = resolveProfileAndToken()
  const url = `http://127.0.0.1:${config.port}${path}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Managed-Profile': config.profile,
      ...options.headers
    }
    const resp = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    }).finally(() => clearTimeout(timeout))
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: resp.ok, status: resp.status, data: json }
  } catch (err: unknown) {
    clearTimeout(timeout)
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}
