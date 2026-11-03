import { ipcRenderer } from 'electron'

export const managedApi = {
  listProjects: () => ipcRenderer.invoke('managed:listProjects'),
  status: () => ipcRenderer.invoke('managed:status'),
  listTasks: (projectId?: string) => ipcRenderer.invoke('managed:listTasks', projectId),
  getExecution: (projectId: string, taskId: string) =>
    ipcRenderer.invoke('managed:getExecution', projectId, taskId),
  getEvidence: (projectId: string, taskId: string, attemptId?: string, evidenceKey?: string) =>
    ipcRenderer.invoke('managed:getEvidence', projectId, taskId, attemptId, evidenceKey),
  presentReviewPacket: (projectId: string, taskId: string, attemptId?: string) =>
    ipcRenderer.invoke('managed:presentReviewPacket', projectId, taskId, attemptId),
  listActivity: (projectId: string, taskId?: string, limit?: number, beforeId?: number) =>
    ipcRenderer.invoke('managed:listActivity', projectId, taskId, limit, beforeId),
  listDrafts: (projectId: string) => ipcRenderer.invoke('managed:listDrafts', projectId),
  createDraft: (projectId: string, draft: Record<string, unknown>) =>
    ipcRenderer.invoke('managed:createDraft', projectId, draft),
  prepareDraft: (projectId: string, draftId: string) =>
    ipcRenderer.invoke('managed:prepareDraft', projectId, draftId),
  approveDraft: (projectId: string, draftId: string, notes?: string) =>
    ipcRenderer.invoke('managed:approveDraft', projectId, draftId, notes),
  authorizeInference: (projectId: string, taskId: string, provider: string, attemptId?: string) =>
    ipcRenderer.invoke('managed:authorizeInference', projectId, taskId, provider, attemptId),
  dispatchTask: (projectId: string, taskId: string, attemptId?: string) =>
    ipcRenderer.invoke('managed:dispatchTask', projectId, taskId, attemptId),
  submitVerdict: (
    projectId: string,
    verdict: Record<string, unknown>,
    authorizationMode?: string
  ) => ipcRenderer.invoke('managed:submitVerdict', projectId, verdict, authorizationMode),
  exportReviewPacket: (
    projectId: string,
    taskId: string,
    markdown: string,
    suggestedFilename?: string
  ) =>
    ipcRenderer.invoke('managed:exportReviewPacket', projectId, taskId, markdown, suggestedFilename)
}
