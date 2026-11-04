import { ipcMain } from 'electron'
import { callEngineRpc, resolveProfileAndToken, resolveBridgeToken } from './managed-resolver'
import type {
  ManagedProjectDTO,
  ManagedTaskDTO,
  ManagedExecutionDTO,
  ManagedEvidenceDTO,
  ManagedCheckDTO,
  ManagedReviewPacketDTO,
  ManagedProjectsResult,
  ManagedTasksResult,
  ManagedExecutionResult,
  ManagedEvidenceResult,
  ManagedReviewPacketResult
} from './managed-types'

function parseManagedChecks(value: unknown): ManagedCheckDTO[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return []
    const check = raw as Record<string, unknown>
    if (typeof check.name !== 'string' || typeof check.status !== 'string') return []
    const exitCode = check.exit_code
    return [{
      name: check.name,
      status: check.status,
      ...(typeof exitCode === 'number' && Number.isFinite(exitCode) || exitCode === null
        ? { exit_code: exitCode as number | null }
        : {})
    }]
  })
}

export * from './managed-types'
export { resolveProfileAndToken, resolveBridgeToken }

export async function fetchManagedProjectsFromEngine(): Promise<ManagedProjectsResult> {
  const data = await callEngineRpc('managed.listProjects', {})
  if (!data.ok) {
    return {
      ok: false,
      status: data.error_code === 'ENGINE_OFFLINE' ? 'OFFLINE' : 'ERROR',
      error_code: String(data.error_code || 'RPC_ERROR'),
      error_message: String(data.error_message || 'RPC method rejected'),
      projects: []
    }
  }
  const payload = (data.data as Record<string, unknown> | undefined) || {}
  const rawProjects = Array.isArray(payload.projects) ? payload.projects : []
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
  return { ok: true, status: 'ONLINE', projects }
}

export async function fetchManagedTasksFromEngine(projectId?: string): Promise<ManagedTasksResult> {
  const params = projectId ? { project_id: projectId } : {}
  const data = await callEngineRpc('managed.listTasks', params)
  if (!data.ok) {
    return {
      ok: false,
      status: data.error_code === 'ENGINE_OFFLINE' ? 'OFFLINE' : 'ERROR',
      error_code: String(data.error_code || 'RPC_ERROR'),
      error_message: String(data.error_message || 'RPC method rejected'),
      project_id: projectId,
      tasks: []
    }
  }
  const payload = (data.data as Record<string, unknown> | undefined) || {}
  const rawTasks = Array.isArray(payload.tasks) ? payload.tasks : []
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
  return { ok: true, status: 'ONLINE', project_id: projectId, tasks }
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
    return {
      ok: false,
      status: data.error_code === 'ENGINE_OFFLINE' ? 'OFFLINE' : 'ERROR',
      error_code: String(data.error_code || 'RPC_ERROR'),
      error_message: String(data.error_message || 'RPC method rejected'),
      execution: null
    }
  }
  const payload = (data.data as Record<string, unknown> | undefined) || {}
  const rawExec = (payload.execution as Record<string, unknown> | undefined) || null
  if (!rawExec) {
    return { ok: true, status: 'ONLINE', execution: null }
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
  return { ok: true, status: 'ONLINE', execution }
}

export async function fetchManagedEvidenceFromEngine(
  projectId: string,
  taskId: string,
  attemptId?: string,
  evidenceKey?: string
): Promise<ManagedEvidenceResult> {
  const data = await callEngineRpc('managed.getEvidence', {
    project_id: projectId,
    task_id: taskId,
    attempt_id: attemptId,
    evidence_key: evidenceKey
  })
  if (!data.ok) {
    return {
      ok: false,
      status: data.error_code === 'ENGINE_OFFLINE' ? 'OFFLINE' : 'ERROR',
      error_code: String(data.error_code || 'RPC_ERROR'),
      error_message: String(data.error_message || 'RPC method rejected'),
      evidence: null
    }
  }
  const payload = (data.data as Record<string, unknown> | undefined) || {}
  const rawEv = (payload.evidence as Record<string, unknown> | undefined) || null
  if (!rawEv) {
    return { ok: true, status: 'ONLINE', evidence: null }
  }
  const evidence: ManagedEvidenceDTO = {
    project_id: String(rawEv.project_id || projectId),
    task_id: String(rawEv.task_id || taskId),
    attempt_id: typeof rawEv.attempt_id === 'string' ? rawEv.attempt_id : null,
    evidence_status:
      (rawEv.evidence_status as ManagedEvidenceDTO['evidence_status']) || 'NOT_FOUND',
    execution_mode: String(rawEv.execution_mode || 'REAL'),
    is_synthetic: Boolean(rawEv.is_synthetic),
    checks: parseManagedChecks(rawEv.checks),
    artifacts: Array.isArray(rawEv.artifacts) ? rawEv.artifacts.map(String) : [],
    canonical_sha256: typeof rawEv.canonical_sha256 === 'string' ? rawEv.canonical_sha256 : null,
    result_sha: typeof rawEv.result_sha === 'string' ? rawEv.result_sha : null,
    evidence_items: Array.isArray(rawEv.evidence_items)
      ? (rawEv.evidence_items as ManagedEvidenceDTO['evidence_items'])
      : [],
    raw_evidence: (rawEv.raw_evidence as Record<string, unknown> | undefined) || null
  }
  return { ok: true, status: 'ONLINE', evidence }
}

export async function fetchManagedReviewPacketFromEngine(
  projectId: string,
  taskId: string,
  attemptId?: string
): Promise<ManagedReviewPacketResult> {
  const data = await callEngineRpc('managed.presentReviewPacket', {
    project_id: projectId,
    task_id: taskId,
    attempt_id: attemptId
  })
  if (!data.ok) {
    return {
      ok: false,
      status: data.error_code === 'ENGINE_OFFLINE' ? 'OFFLINE' : 'ERROR',
      error_code: String(data.error_code || 'RPC_ERROR'),
      error_message: String(data.error_message || 'RPC method rejected'),
      review_packet: null
    }
  }
  const payload = (data.data as Record<string, unknown> | undefined) || {}
  const rawPkt = (payload.review_packet as Record<string, unknown> | undefined) || null
  if (!rawPkt) {
    return { ok: true, status: 'ONLINE', review_packet: null }
  }
  const review_packet: ManagedReviewPacketDTO = {
    project_id: String(rawPkt.project_id || projectId),
    task_id: String(rawPkt.task_id || taskId),
    repo_id: String(rawPkt.repo_id || ""),
    task_sha256: typeof rawPkt.task_sha256 === "string" ? rawPkt.task_sha256 : null,
    context_checkpoint_sha256:
      typeof rawPkt.context_checkpoint_sha256 === "string"
        ? rawPkt.context_checkpoint_sha256
        : null,
    attempt_id: typeof rawPkt.attempt_id === 'string' ? rawPkt.attempt_id : null,
    packet_status: (rawPkt.packet_status as ManagedReviewPacketDTO['packet_status']) || 'NOT_FOUND',
    provenance: String(rawPkt.provenance || 'UNVERIFIED'),
    hash_status: String(rawPkt.hash_status || 'NOT_RUN'),
    certification_status: String(rawPkt.certification_status || 'UNCERTIFIED'),
    is_synthetic: Boolean(rawPkt.is_synthetic),
    execution_type: String(rawPkt.execution_type || 'REAL'),
    status: String(rawPkt.status || 'NOT_RUN'),
    base_sha: typeof rawPkt.base_sha === 'string' ? rawPkt.base_sha : null,
    result_sha: typeof rawPkt.result_sha === 'string' ? rawPkt.result_sha : null,
    canonical_sha256: typeof rawPkt.canonical_sha256 === 'string' ? rawPkt.canonical_sha256 : null,
    started_at: typeof rawPkt.started_at === 'string' ? rawPkt.started_at : null,
    finished_at: typeof rawPkt.finished_at === 'string' ? rawPkt.finished_at : null,
    process_exit_code:
      typeof rawPkt.process_exit_code === 'number' ? rawPkt.process_exit_code : null,
    verdict: typeof rawPkt.verdict === 'string' ? rawPkt.verdict : null,
    checks_count: Number(rawPkt.checks_count || 0),
    checks_summary: rawPkt.checks_summary && typeof rawPkt.checks_summary === 'object'
      ? (rawPkt.checks_summary as ManagedReviewPacketDTO['checks_summary'])
      : { passed: 0, failed: 0, total: 0 },
    checks: parseManagedChecks(rawPkt.checks),
    markdown_packet: typeof rawPkt.markdown_packet === 'string' ? rawPkt.markdown_packet : null
  }
  return { ok: true, status: 'ONLINE', review_packet }
}

import { fetchManagedActivityFromEngine } from './managed-activity'
import { registerManagedMutationHandlers, trustedDesktopWindow } from './managed-mutation-handlers'
import { probeEdgeBridgeHealth } from './managed-edge-health'
export { fetchManagedActivityFromEngine }
export * from './managed-mutations'

export function registerManagedHandlers(): () => void {
  const handlers = [
    'managed:listProjects',
    'managed:status',
    'managed:edgeHealth',
    'managed:listTasks',
    'managed:getExecution',
    'managed:getEvidence',
    'managed:presentReviewPacket',
    'managed:listActivity'
  ]
  for (const h of handlers) {
    ipcMain.removeHandler(h)
  }

  ipcMain.handle('managed:listProjects', () => fetchManagedProjectsFromEngine())
  ipcMain.handle('managed:status', async () => {
    const res = await fetchManagedProjectsFromEngine()
    const cfg = resolveProfileAndToken()
    return { status: res.status, ok: res.ok, profile: cfg.profile }
  })
  ipcMain.handle('managed:edgeHealth', (event) =>
    trustedDesktopWindow(event)
      ? probeEdgeBridgeHealth()
      : { status: 'ERROR', port: 8768, error_code: 'DESKTOP_OPERATOR_REQUIRED' }
  )
  ipcMain.handle('managed:listTasks', (_e, p?: string) => fetchManagedTasksFromEngine(p))
  ipcMain.handle('managed:getExecution', (_e, p: string, t: string) =>
    fetchManagedExecutionFromEngine(p, t)
  )
  ipcMain.handle('managed:getEvidence', (_e, p: string, t: string, a?: string, k?: string) =>
    fetchManagedEvidenceFromEngine(p, t, a, k)
  )
  ipcMain.handle('managed:presentReviewPacket', (_e, p: string, t: string, a?: string) =>
    fetchManagedReviewPacketFromEngine(p, t, a)
  )
  ipcMain.handle('managed:listActivity', (_e, p: string, t?: string, l?: number, b?: number) =>
    fetchManagedActivityFromEngine(p, t, l, b)
  )

  const unregMutations = registerManagedMutationHandlers()

  return () => {
    for (const h of handlers) {
      ipcMain.removeHandler(h)
    }
    unregMutations()
  }
}
