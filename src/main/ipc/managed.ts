import { ipcMain } from 'electron'

export type ManagedProjectDTO = {
  readonly id: string
  readonly name: string
  readonly description?: string | null
  readonly status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'UNKNOWN'
  readonly mode: 'MANAGED' | 'FREE' | 'LOCAL'
  readonly created_at?: string | null
  readonly updated_at?: string | null
}

export type ManagedProjectsResult = {
  readonly ok: boolean
  readonly status: 'ONLINE' | 'OFFLINE' | 'ERROR'
  readonly error_code?: string
  readonly error_message?: string
  readonly projects: readonly ManagedProjectDTO[]
}

const PYTHON_ENGINE_URL = 'http://127.0.0.1:8765/api/managed/rpc'

export async function fetchManagedProjectsFromEngine(): Promise<ManagedProjectsResult> {
  const payload = {
    request_id: `req-orca-${Date.now()}`,
    method: 'managed.listProjects',
    protocol: { name: 'managed', major: 1, minor: 0 },
    // Host identity constructed strictly by Electron Main, never trusting renderer claims
    caller: {
      surface: 'renderer',
      authenticated: true,
      capabilities: ['VIEW']
    },
    params: {}
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)

    const resp = await fetch(PYTHON_ENGINE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    }).finally(() => clearTimeout(timeout))

    if (!resp.ok) {
      return {
        ok: false,
        status: 'ERROR',
        error_code: `HTTP_${resp.status}`,
        error_message: `Engine HTTP error: ${resp.statusText}`,
        projects: []
      }
    }

    const data = (await resp.json()) as Record<string, unknown>
    if (!data.ok) {
      return {
        ok: false,
        status: 'ERROR',
        error_code: String(data.error_code || 'RPC_ERROR'),
        error_message: String(data.error_message || 'RPC method rejected'),
        projects: []
      }
    }

    const respPayload = (data.data as Record<string, unknown> | undefined) || {}
    const rawProjects = Array.isArray(respPayload.projects) ? respPayload.projects : []
    const projects: ManagedProjectDTO[] = rawProjects.map((rawItem: unknown) => {
      const p = (rawItem as Record<string, unknown>) || {}
      return {
        id: String(p.id || ''),
        name: String(p.name || p.id || ''),
        description: typeof p.description === 'string' ? p.description : null,
        status: (p.status as ManagedProjectDTO['status']) || 'ACTIVE',
        mode: (p.mode as ManagedProjectDTO['mode']) || 'MANAGED',
        created_at: typeof p.created_at === 'string' ? p.created_at : null,
        updated_at: typeof p.updated_at === 'string' ? p.updated_at : null
      }
    })

    return {
      ok: true,
      status: 'ONLINE',
      projects
    }
  } catch {
    // If connection refused or timeout, motor is OFFLINE.
    // Do NOT start it silently or spawn agents!
    return {
      ok: false,
      status: 'OFFLINE',
      error_code: 'ENGINE_OFFLINE',
      error_message: 'Motor Python desconectado (OFFLINE en http://127.0.0.1:8765)',
      projects: []
    }
  }
}

export function registerManagedHandlers(): () => void {
  ipcMain.removeHandler('managed:listProjects')
  ipcMain.removeHandler('managed:status')

  ipcMain.handle('managed:listProjects', async () => {
    return await fetchManagedProjectsFromEngine()
  })

  ipcMain.handle('managed:status', async () => {
    const res = await fetchManagedProjectsFromEngine()
    return { status: res.status, ok: res.ok }
  })

  return () => {
    ipcMain.removeHandler('managed:listProjects')
    ipcMain.removeHandler('managed:status')
  }
}
