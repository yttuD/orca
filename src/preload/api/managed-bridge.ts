import { ipcRenderer } from 'electron'

export const managedApi = {
  listProjects: () => ipcRenderer.invoke('managed:listProjects'),
  status: () => ipcRenderer.invoke('managed:status'),
  listTasks: (projectId?: string) => ipcRenderer.invoke('managed:listTasks', projectId),
  getExecution: (projectId: string, taskId: string) =>
    ipcRenderer.invoke('managed:getExecution', projectId, taskId)
}
