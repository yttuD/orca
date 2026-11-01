import { ipcRenderer } from 'electron'

export const managedApi = {
  listProjects: () => ipcRenderer.invoke('managed:listProjects'),
  status: () => ipcRenderer.invoke('managed:status')
}
