import type {
  ManagedDataProvider,
  ManagedProjectDTO,
  ManagedTaskDTO,
  ManagedEvidenceDTO,
  MobileConnectionStatus
} from './types'
import {
  SYNTHETIC_MANAGED_PROJECTS,
  SYNTHETIC_MANAGED_TASKS,
  SYNTHETIC_MANAGED_EVIDENCE
} from './fixtures'
import type { RpcClient } from '../transport/rpc-client'

export class EncryptedRpcManagedDataProvider implements ManagedDataProvider {
  constructor(
    private readonly rpcClient: RpcClient,
    private readonly getStatus?: () => MobileConnectionStatus
  ) {}

  getConnectionStatus(): MobileConnectionStatus {
    if (this.getStatus) {
      return this.getStatus()
    }
    const state = this.rpcClient.getState()
    if (state.kind === 'connected') {
      return 'ONLINE'
    }
    if (state.kind === 'connecting') {
      return 'CONNECTING'
    }
    return 'OFFLINE'
  }

  async listProjects(): Promise<readonly ManagedProjectDTO[]> {
    const status = this.getConnectionStatus()
    if (status !== 'ONLINE') {
      throw new Error(`Cannot list projects: connection is ${status}`)
    }
    const res = await this.rpcClient.request('managed.listProjects', {})
    if (!res || typeof res !== 'object') {
      return []
    }
    const data = res as { projects?: readonly ManagedProjectDTO[] }
    return data.projects ?? []
  }

  async listTasks(projectId: string): Promise<readonly ManagedTaskDTO[]> {
    const status = this.getConnectionStatus()
    if (status !== 'ONLINE') {
      throw new Error(`Cannot list tasks: connection is ${status}`)
    }
    const res = await this.rpcClient.request('managed.listTasks', { projectId })
    if (!res || typeof res !== 'object') {
      return []
    }
    const data = res as { tasks?: readonly ManagedTaskDTO[] }
    return data.tasks ?? []
  }

  async getEvidence(projectId: string, taskId: string): Promise<ManagedEvidenceDTO | null> {
    const status = this.getConnectionStatus()
    if (status !== 'ONLINE') {
      throw new Error(`Cannot get evidence: connection is ${status}`)
    }
    const res = await this.rpcClient.request('managed.getEvidence', { projectId, taskId })
    if (!res || typeof res !== 'object') {
      return null
    }
    const data = res as { evidence?: ManagedEvidenceDTO }
    return data.evidence ?? null
  }
}

export class DemoManagedDataProvider implements ManagedDataProvider {
  getConnectionStatus(): MobileConnectionStatus {
    return 'ONLINE'
  }

  async listProjects(): Promise<readonly ManagedProjectDTO[]> {
    return SYNTHETIC_MANAGED_PROJECTS
  }

  async listTasks(projectId: string): Promise<readonly ManagedTaskDTO[]> {
    return SYNTHETIC_MANAGED_TASKS[projectId] ?? []
  }

  async getEvidence(_projectId: string, taskId: string): Promise<ManagedEvidenceDTO | null> {
    return SYNTHETIC_MANAGED_EVIDENCE[taskId] ?? null
  }
}
