import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

export type ManagedTaskDTO = {
  readonly id: string
  readonly project_id: string
  readonly title: string
  readonly status: string
  readonly executor: string
  readonly created_at?: string | null
  readonly updated_at?: string | null
}

export type ManagedExecutionDTO = {
  readonly task_id: string
  readonly project_id: string
  readonly status: string
  readonly executor: string
  readonly attempt_id?: string | null
  readonly lease_owner: string
  readonly lease_generation: number
  readonly last_activity?: string | null
  readonly verdict?: string | null
}

export type ManagedProjectsResult = {
  readonly ok: boolean
  readonly status: 'ONLINE' | 'OFFLINE' | 'ERROR'
  readonly error_code?: string
  readonly error_message?: string
  readonly projects: readonly ManagedProjectDTO[]
}

export type ManagedTasksResult = {
  readonly ok: boolean
  readonly status: 'ONLINE' | 'OFFLINE' | 'ERROR'
  readonly error_code?: string
  readonly error_message?: string
  readonly project_id?: string
  readonly tasks: readonly ManagedTaskDTO[]
}

export type ManagedExecutionResult = {
  readonly ok: boolean
  readonly status: 'ONLINE' | 'OFFLINE' | 'ERROR'
  readonly error_code?: string
  readonly error_message?: string
  readonly execution?: ManagedExecutionDTO | null
}

const PYTHON_ENGINE_URL = 'http://127.0.0.1:8765/api/managed/rpc'

/**
 * Resolves the operator bridge token securely from local process environment or disk.
 * The token is kept strictly in Electron Main and NEVER forwarded to renderer.
 */
export function resolveBridgeToken(): string | null {
  if (process.env.ORCHESTRATOR_TOKEN) {
    return process.env.ORCHESTRATOR_TOKEN.trim()
  }
  if (process.env.OPERATOR_TOKEN) {
    return process.env.OPERATOR_TOKEN.trim()
  }
  const candidatePaths = [
    join(process.cwd(), '.operator_token'),
    resolve(process.cwd(), '../ORQUESTADOR-MASTER/.operator_token'),
    'D:/Programacion-Cosas/ORQUESTADOR-MASTER/.operator_token',
    'D:\\Programacion-Cosas\\ORQUESTADOR-MASTER\\.operator_token'
  ]
  for (const p of candidatePaths) {
    try {
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf8').trim()
        if (content) {
          return content
        }
      }
    } catch {
      // ignore
    }
  }
  return null
}

async function callEngineRpc(
  method: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const token = resolveBridgeToken()
  const payload = {
    request_id: `req-orca-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    method,
    protocol: { name: 'managed', major: 1, minor: 0 },
    caller: {
      surface: 'renderer',
      authenticated: Boolean(token),
      capabilities: ['VIEW']
    },
    params
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2500)

  try {
    const resp = await fetch(PYTHON_ENGINE_URL, {
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

export async function fetchManagedProjectsFromEngine(): Promise<ManagedProjectsResult> {
  const data = await callEngineRpc('managed.listProjects', {})

  if (!data.ok) {
    const isOffline = data.error_code === 'ENGINE_OFFLINE'
    return {
      ok: false,
      status: isOffline ? 'OFFLINE' : 'ERROR',
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
}

export async function fetchManagedTasksFromEngine(projectId?: string): Promise<ManagedTasksResult> {
  const params = projectId ? { project_id: projectId } : {}
  const data = await callEngineRpc('managed.listTasks', params)

  if (!data.ok) {
    const isOffline = data.error_code === 'ENGINE_OFFLINE'
    return {
      ok: false,
      status: isOffline ? 'OFFLINE' : 'ERROR',
      error_code: String(data.error_code || 'RPC_ERROR'),
      error_message: String(data.error_message || 'RPC method rejected'),
      project_id: projectId,
      tasks: []
    }
  }

  const respPayload = (data.data as Record<string, unknown> | undefined) || {}
  const rawTasks = Array.isArray(respPayload.tasks) ? respPayload.tasks : []
  const tasks: ManagedTaskDTO[] = rawTasks.map((rawItem: unknown) => {
    const t = (rawItem as Record<string, unknown>) || {}
    return {
      id: String(t.id || ''),
      project_id: String(t.project_id || projectId || ''),
      title: String(t.title || t.id || ''),
      status: String(t.status || 'PENDING'),
      executor: String(t.executor || 'CODEX'),
      created_at: typeof t.created_at === 'string' ? t.created_at : null,
      updated_at: typeof t.updated_at === 'string' ? t.updated_at : null
    }
  })

  return {
    ok: true,
    status: 'ONLINE',
    project_id: projectId,
    tasks
  }
}

export async function fetchManagedExecutionFromEngine(
  projectId: string,
  taskId: string
): Promise<ManagedExecutionResult> {
  const data = await callEngineRpc('managed.getExecution', {
    project_id: projectId,
    task_id: taskId
  })

  if (!data.ok) {
    const isOffline = data.error_code === 'ENGINE_OFFLINE'
    return {
      ok: false,
      status: isOffline ? 'OFFLINE' : 'ERROR',
      error_code: String(data.error_code || 'RPC_ERROR'),
      error_message: String(data.error_message || 'RPC method rejected'),
      execution: null
    }
  }

  const respPayload = (data.data as Record<string, unknown> | undefined) || {}
  const rawExec = (respPayload.execution as Record<string, unknown> | undefined) || null
  if (!rawExec) {
    return {
      ok: true,
      status: 'ONLINE',
      execution: null
    }
  }

  const execution: ManagedExecutionDTO = {
    task_id: String(rawExec.task_id || taskId),
    project_id: String(rawExec.project_id || projectId),
    status: String(rawExec.status || 'PENDING'),
    executor: String(rawExec.executor || 'CODEX'),
    attempt_id: typeof rawExec.attempt_id === 'string' ? rawExec.attempt_id : null,
    lease_owner: String(rawExec.lease_owner || 'NONE'),
    lease_generation: Number(rawExec.lease_generation || 0),
    last_activity: typeof rawExec.last_activity === 'string' ? rawExec.last_activity : null,
    verdict: typeof rawExec.verdict === 'string' ? rawExec.verdict : null
  }

  return {
    ok: true,
    status: 'ONLINE',
    execution
  }
}

export function registerManagedHandlers(): () => void {
  ipcMain.removeHandler('managed:listProjects')
  ipcMain.removeHandler('managed:status')
  ipcMain.removeHandler('managed:listTasks')
  ipcMain.removeHandler('managed:getExecution')

  ipcMain.handle('managed:listProjects', async () => {
    return await fetchManagedProjectsFromEngine()
  })

  ipcMain.handle('managed:status', async () => {
    const res = await fetchManagedProjectsFromEngine()
    return { status: res.status, ok: res.ok }
  })

  ipcMain.handle('managed:listTasks', async (_event, projectId?: string) => {
    return await fetchManagedTasksFromEngine(projectId)
  })

  ipcMain.handle('managed:getExecution', async (_event, projectId: string, taskId: string) => {
    return await fetchManagedExecutionFromEngine(projectId, taskId)
  })

  return () => {
    ipcMain.removeHandler('managed:listProjects')
    ipcMain.removeHandler('managed:status')
    ipcMain.removeHandler('managed:listTasks')
    ipcMain.removeHandler('managed:getExecution')
  }
}
