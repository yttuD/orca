import { callEngineRpc } from './managed-resolver'
import type { ManagedActivityItemDTO, ManagedActivityResult } from './managed-types'

export async function fetchManagedActivityFromEngine(
  projectId: string,
  taskId?: string,
  limit: number = 20,
  beforeId?: number
): Promise<ManagedActivityResult> {
  const data = await callEngineRpc('managed.listActivity', {
    project_id: projectId,
    task_id: taskId,
    limit,
    before_id: beforeId
  })
  if (!data.ok) {
    return {
      ok: false,
      status: data.error_code === 'ENGINE_OFFLINE' ? 'OFFLINE' : 'ERROR',
      error_code: String(data.error_code || 'RPC_ERROR'),
      error_message: String(data.error_message || 'RPC method rejected'),
      project_id: projectId,
      activities: []
    }
  }
  const payload = (data.data as Record<string, unknown> | undefined) || {}
  const rawActs = Array.isArray(payload.activities) ? payload.activities : []
  const activities: ManagedActivityItemDTO[] = rawActs.map((item: unknown) => {
    const a = (item as Record<string, unknown>) || {}
    return {
      id: typeof a.id === 'number' ? a.id : undefined,
      task_id: String(a.task_id || taskId || ''),
      attempt_id: typeof a.attempt_id === 'string' ? a.attempt_id : null,
      from_state: String(a.from_state || ''),
      to_state: String(a.to_state || ''),
      reason: String(a.reason || ''),
      timestamp: typeof a.timestamp === 'string' ? a.timestamp : null
    }
  })
  return { ok: true, status: 'ONLINE', project_id: projectId, activities }
}

