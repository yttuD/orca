import { ipcMain, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { callOperatorEndpoint, checkAndMarkAction } from './managed-operator-session'
import type { ManagedDraftDTO, ManagedDraftsResult, ManagedMutationResult } from './managed-types'

export async function fetchManagedDraftsFromEngine(
  projectId: string
): Promise<ManagedDraftsResult> {
  const res = await callOperatorEndpoint(
    `/api/projects/${encodeURIComponent(projectId)}/drafts`,
    'GET'
  )
  if (!res.ok) {
    return {
      ok: false,
      status: res.status === 0 ? 'OFFLINE' : 'ERROR',
      error_code: `HTTP_${res.status}`,
      error_message: res.error || 'Fallo al listar borradores.',
      drafts: []
    }
  }
  const payload = res.data || {}
  const rawDrafts = Array.isArray(payload.drafts) ? payload.drafts : []
  const drafts: ManagedDraftDTO[] = rawDrafts.map((raw: unknown) => {
    const d = (raw as Record<string, unknown>) || {}
    return {
      draft_id: String(d.draft_id || d.id || ''),
      project_id: String(d.project_id || projectId),
      title: String(d.title || ''),
      description: String(d.description || d.instructions || ''),
      executor: String(d.executor || 'codex'),
      model: typeof d.model === 'string' ? d.model : null,
      base_ref: String(d.base_ref || 'refs/heads/main'),
      base_sha: typeof d.base_sha === 'string' ? d.base_sha : null,
      state: String(d.state || 'DRAFT'),
      envelope: (d.envelope as Record<string, unknown> | undefined) || null,
      task_id: typeof d.task_id === 'string' ? d.task_id : null,
      allowed_paths: Array.isArray(d.allowed_paths) ? d.allowed_paths.map(String) : [],
      requested_checks: Array.isArray(d.requested_checks) ? d.requested_checks.map(String) : [],
      max_runtime_seconds: typeof d.max_runtime_seconds === 'number' ? d.max_runtime_seconds : 600,
      created_at: typeof d.created_at === 'string' ? d.created_at : null,
      updated_at: typeof d.updated_at === 'string' ? d.updated_at : null
    }
  })
  return { ok: true, status: 'ONLINE', drafts }
}

export async function createOrUpdateDraftInEngine(
  projectId: string,
  draft: Record<string, unknown>
): Promise<ManagedMutationResult> {
  const res = await callOperatorEndpoint(
    `/api/projects/${encodeURIComponent(projectId)}/drafts`,
    'POST',
    draft
  )
  if (!res.ok) {
    return {
      ok: false,
      status: 'ERROR',
      error_code: `HTTP_${res.status}`,
      error_message: res.error || 'Fallo al crear o actualizar borrador.'
    }
  }
  return { ok: true, status: 'SUCCESS', data: res.data }
}

export async function prepareDraftInEngine(
  projectId: string,
  draftId: string
): Promise<ManagedMutationResult> {
  const actionKey = `prepare:${projectId}:${draftId}`
  if (!checkAndMarkAction(actionKey)) {
    return {
      ok: false,
      status: 'ERROR',
      error_code: 'DUPLICATE_ACTION',
      error_message: 'Acción duplicada en curso.'
    }
  }
  const res = await callOperatorEndpoint(
    `/api/projects/${encodeURIComponent(projectId)}/drafts/${encodeURIComponent(draftId)}/prepare`,
    'POST'
  )
  if (!res.ok) {
    return {
      ok: false,
      status: 'ERROR',
      error_code: `HTTP_${res.status}`,
      error_message: res.error || 'Fallo al preparar borrador.'
    }
  }
  return { ok: true, status: 'SUCCESS', data: res.data }
}

export async function approveDraftInEngine(
  projectId: string,
  draftId: string,
  operatorNotes?: string
): Promise<ManagedMutationResult> {
  const actionKey = `approve:${projectId}:${draftId}`
  if (!checkAndMarkAction(actionKey)) {
    return {
      ok: false,
      status: 'ERROR',
      error_code: 'DUPLICATE_ACTION',
      error_message: 'Acción de aprobación duplicada en curso.'
    }
  }
  const res = await callOperatorEndpoint(
    `/api/projects/${encodeURIComponent(projectId)}/drafts/${encodeURIComponent(draftId)}/approve`,
    'POST',
    {
      operator_approval: true,
      operator_notes: operatorNotes || 'Aprobado manualmente por operador Windows vía Orca Desktop.'
    }
  )
  if (!res.ok) {
    return {
      ok: false,
      status: 'ERROR',
      error_code: `HTTP_${res.status}`,
      error_message: res.error || 'Fallo al aprobar y encolar borrador.'
    }
  }
  return { ok: true, status: 'SUCCESS', data: res.data }
}

export async function dispatchTaskInEngine(
  projectId: string,
  taskId: string,
  attemptId = 'ATT-001'
): Promise<ManagedMutationResult> {
  const actionKey = `dispatch:${projectId}:${taskId}:${attemptId}`
  if (!checkAndMarkAction(actionKey)) {
    return {
      ok: false,
      status: 'ERROR',
      error_code: 'DUPLICATE_ACTION',
      error_message: 'Despacho duplicado en curso.'
    }
  }
  const res = await callOperatorEndpoint(
    `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/dispatch`,
    'POST',
    { attempt_id: attemptId }
  )
  if (!res.ok) {
    return {
      ok: false,
      status: 'ERROR',
      error_code: `HTTP_${res.status}`,
      error_message: res.error || 'Fallo al despachar la tarea.'
    }
  }
  return { ok: true, status: 'SUCCESS', data: res.data }
}

export async function submitVerdictToEngine(
  projectId: string,
  verdict: Record<string, unknown>,
  authorizationMode = 'MANUAL_LOCAL_VERIFIED'
): Promise<ManagedMutationResult> {
  const taskId = String(verdict.task_id || '')
  const actionKey = `verdict:${projectId}:${taskId}`
  if (!checkAndMarkAction(actionKey)) {
    return {
      ok: false,
      status: 'ERROR',
      error_code: 'DUPLICATE_ACTION',
      error_message: 'Veredicto duplicado en curso.'
    }
  }
  const res = await callOperatorEndpoint(
    `/api/projects/${encodeURIComponent(projectId)}/verdict`,
    'POST',
    {
      verdict,
      operator_approval: true,
      authorization_mode: authorizationMode
    }
  )
  if (!res.ok) {
    return {
      ok: false,
      status: 'ERROR',
      error_code: `HTTP_${res.status}`,
      error_message: res.error || 'Fallo al ingresar veredicto del Arquitecto.'
    }
  }
  return { ok: true, status: 'SUCCESS', data: res.data }
}

export async function exportReviewPacketToFile(
  projectId: string,
  taskId: string,
  markdownContent: string,
  suggestedFilename?: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const filename = suggestedFilename || `review-packet-${projectId}-${taskId}.md`
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Guardar ReviewPacket',
      defaultPath: filename,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (canceled || !filePath) {
      return { ok: false, error: 'Exportación cancelada por el usuario.' }
    }
    writeFileSync(filePath, markdownContent, { encoding: 'utf-8' })
    return { ok: true, path: filePath }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function registerManagedMutationHandlers(): () => void {
  const handlers = [
    'managed:listDrafts',
    'managed:createDraft',
    'managed:prepareDraft',
    'managed:approveDraft',
    'managed:dispatchTask',
    'managed:submitVerdict',
    'managed:exportReviewPacket'
  ]
  for (const h of handlers) {
    ipcMain.removeHandler(h)
  }

  ipcMain.handle('managed:listDrafts', (_e, p: string) => fetchManagedDraftsFromEngine(p))
  ipcMain.handle('managed:createDraft', (_e, p: string, d: Record<string, unknown>) =>
    createOrUpdateDraftInEngine(p, d)
  )
  ipcMain.handle('managed:prepareDraft', (_e, p: string, dId: string) =>
    prepareDraftInEngine(p, dId)
  )
  ipcMain.handle('managed:approveDraft', (_e, p: string, dId: string, notes?: string) =>
    approveDraftInEngine(p, dId, notes)
  )
  ipcMain.handle('managed:dispatchTask', (_e, p: string, tId: string, aId?: string) =>
    dispatchTaskInEngine(p, tId, aId)
  )
  ipcMain.handle(
    'managed:submitVerdict',
    (_e, p: string, v: Record<string, unknown>, mode?: string) => submitVerdictToEngine(p, v, mode)
  )
  ipcMain.handle(
    'managed:exportReviewPacket',
    (_e, p: string, tId: string, md: string, fn?: string) =>
      exportReviewPacketToFile(p, tId, md, fn)
  )

  return () => {
    for (const h of handlers) {
      ipcMain.removeHandler(h)
    }
  }
}
