import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
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

/**
 * Only the trusted top-level Electron renderer may ask to perform host-local
 * mutations. A paired Android client or subframe never receives this capability.
 * A native confirmation dialog supplies the required operator gesture for
 * irreversible or paid actions; renderer-provided flags are NOT consent.
 */
function trustedDesktopWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed() || event.senderFrame !== win.webContents.mainFrame) {
    return null
  }
  return win
}

const forbidden = (): ManagedMutationResult => ({
  ok: false,
  status: 'ERROR',
  error_code: 'DESKTOP_OPERATOR_REQUIRED',
  error_message: 'Solo el escritorio local autorizado puede gestionar tareas.'
})

async function confirmDesktopAction(
  win: BrowserWindow,
  action: string,
  detail: string
): Promise<boolean> {
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Cancelar', 'Autorizar'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Orcastrator — autorización local',
    message: action,
    detail
  })
  return result.response === 1
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

  ipcMain.handle('managed:listDrafts', (event, p: string) => {
    if (!trustedDesktopWindow(event)) return forbidden()
    return fetchManagedDraftsFromEngine(p)
  })
  ipcMain.handle('managed:createDraft', (event, p: string, d: Record<string, unknown>) => {
    if (!trustedDesktopWindow(event)) return forbidden()
    return createOrUpdateDraftInEngine(p, d)
  })
  ipcMain.handle('managed:prepareDraft', (event, p: string, dId: string) => {
    if (!trustedDesktopWindow(event)) return forbidden()
    return prepareDraftInEngine(p, dId)
  })
  ipcMain.handle('managed:approveDraft', async (event, p: string, dId: string, notes?: string) => {
    const win = trustedDesktopWindow(event)
    if (!win) return forbidden()
    const yes = await confirmDesktopAction(
      win,
      'Aprobar y encolar una tarea gestionada',
      `Proyecto: ${p}\nBorrador: ${dId}\nEsto registra una aprobación durable del operador.`
    )
    if (!yes) return { ...forbidden(), error_code: 'OPERATOR_DECLINED', error_message: 'Aprobación cancelada.' }
    return approveDraftInEngine(p, dId, notes)
  })
  ipcMain.handle('managed:dispatchTask', async (event, p: string, tId: string, aId?: string) => {
    const win = trustedDesktopWindow(event)
    if (!win) return forbidden()
    const yes = await confirmDesktopAction(
      win,
      'Despachar una tarea gestionada',
      `Proyecto: ${p}\nTarea: ${tId}\nIntento: ${aId || 'ATT-001'}\nEl backend exigirá consentimiento de inferencia separado y Job Object válido.`
    )
    if (!yes) return { ...forbidden(), error_code: 'OPERATOR_DECLINED', error_message: 'Despacho cancelado.' }
    return dispatchTaskInEngine(p, tId, aId)
  })
  ipcMain.handle(
    'managed:submitVerdict',
    async (event, p: string, v: Record<string, unknown>, mode?: string) => {
      const win = trustedDesktopWindow(event)
      if (!win) return forbidden()
      const taskId = typeof v?.task_id === 'string' ? v.task_id : 'DESCONOCIDA'
      const decision = typeof v?.decision === 'string' ? v.decision : 'DESCONOCIDA'
      const yes = await confirmDesktopAction(
        win,
        'Confirmar veredicto del arquitecto de chat manual',
        `Proyecto: ${p}\nTarea: ${taskId}\nDecisión: ${decision}\nEl proveedor es una declaración del operador. El motor verificará los hashes y la evidencia.`
      )
      if (!yes) return { ...forbidden(), error_code: 'OPERATOR_DECLINED', error_message: 'Veredicto cancelado.' }
      return submitVerdictToEngine(p, v, mode)
    }
  )
  ipcMain.handle(
    'managed:exportReviewPacket',
    (event, p: string, tId: string, md: string, fn?: string) => {
      if (!trustedDesktopWindow(event)) return { ok: false, error: 'DESKTOP_OPERATOR_REQUIRED' }
      return exportReviewPacketToFile(p, tId, md, fn)
    }
  )

  return () => {
    for (const h of handlers) {
      ipcMain.removeHandler(h)
    }
  }
}
