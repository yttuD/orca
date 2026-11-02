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
    ipcRenderer.invoke('managed:listActivity', projectId, taskId, limit, beforeId)
}
