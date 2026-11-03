import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { ManagedMutationResult } from './managed-types'
import {
  fetchManagedDraftsFromEngine,
  createOrUpdateDraftInEngine,
  prepareDraftInEngine,
  approveDraftInEngine,
  authorizeInferenceInEngine,
  dispatchTaskInEngine,
  submitVerdictToEngine,
  exportReviewPacketToFile
} from './managed-mutations'

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
    'managed:authorizeInference',
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
  ipcMain.handle(
    'managed:authorizeInference',
    async (event, p: string, tId: string, provider: string, aId?: string) => {
      const win = trustedDesktopWindow(event)
      if (!win) return forbidden()
      const yes = await confirmDesktopAction(
        win,
        'Autorizar consumo de inferencia para esta tarea',
        `Proyecto: ${p}\\nTarea: ${tId}\\nEjecutor: ${provider}\\nIntento: ${aId || 'ATT-001'}\\nPuede consumir cuota o generar costos. Esta autorización queda registrada por el motor y NO inicia el despacho.`
      )
      if (!yes) return { ...forbidden(), error_code: 'OPERATOR_DECLINED', error_message: 'Consentimiento cancelado.' }
      return authorizeInferenceInEngine(p, tId, provider, aId)
    }
  )
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
