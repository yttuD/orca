import type {
  ManagedDataProvider,
  ManagedProjectDTO,
  ManagedTaskDTO,
  ManagedEvidenceDTO,
  MobileConnectionStatus,
  MobileDeviceCredential
} from './types'
import {
  SYNTHETIC_MANAGED_PROJECTS,
  SYNTHETIC_MANAGED_TASKS,
  SYNTHETIC_MANAGED_EVIDENCE
} from './fixtures'
import type { RpcClient } from '../transport/rpc-client'

export class EncryptedRpcManagedDataProvider implements ManagedDataProvider {
  private authenticated = false
  private authError: string | null = null

  constructor(
    private readonly rpcClient: RpcClient,
    private readonly credential?: MobileDeviceCredential | null
  ) {}

  getConnectionStatus(): MobileConnectionStatus {
    if (!this.credential) {
      return 'UNPAIRED'
    }
    if (this.credential.revoked) {
      return 'AUTH_REQUIRED'
    }
    if (Date.now() > this.credential.expiresAt) {
      return 'AUTH_REQUIRED'
    }
    const state = this.rpcClient.getState()
    if (state.kind !== 'connected') {
      this.authenticated = false
      return state.kind === 'connecting' ? 'CONNECTING' : 'OFFLINE'
    }
    if (this.authError) {
      return 'AUTH_REQUIRED'
    }
    if (!this.authenticated) {
      return 'CONNECTING'
    }
    return 'ONLINE'
  }

  setAuthenticated(isAuth: boolean): void {
    this.authenticated = isAuth
    if (isAuth) {
      this.authError = null
    }
  }

  setAuthError(err: string | null): void {
    this.authError = err
    if (err) {
      this.authenticated = false
    }
  }

  async probeAuthentication(): Promise<MobileConnectionStatus> {
    if (!this.credential) {
      return 'UNPAIRED'
    }
    const state = this.rpcClient.getState()
    if (state.kind !== 'connected') {
      this.authenticated = false
      return state.kind === 'connecting' ? 'CONNECTING' : 'OFFLINE'
    }
    try {
      const res = await this.rpcClient.request('managed.listProjects', {})
      if (res && typeof res === 'object') {
        this.authenticated = true
        this.authError = null
        return 'ONLINE'
      }
      this.authenticated = false
      return 'OFFLINE'
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (
        msg.includes('AUTH_REQUIRED') ||
        msg.includes('UNAUTHORIZED') ||
        msg.includes('PENDING') ||
        msg.includes('INVALID_TOKEN') ||
        msg.includes('401')
      ) {
        this.authenticated = false
        this.authError = msg
        return 'AUTH_REQUIRED'
      }
      this.authenticated = false
      return 'OFFLINE'
    }
  }

  async listProjects(): Promise<readonly ManagedProjectDTO[]> {
    const current = this.getConnectionStatus()
    if (current === 'UNPAIRED') {
      throw new Error('Cannot list projects: device is UNPAIRED')
    }
    if (current === 'OFFLINE') {
      throw new Error('Cannot list projects: connection is OFFLINE')
    }
    try {
      const res = await this.rpcClient.request('managed.listProjects', {})
      if (!res || typeof res !== 'object') {
        return []
      }
      this.authenticated = true
      this.authError = null
      const data = res as { projects?: readonly ManagedProjectDTO[] }
      return data.projects ?? []
    } catch (err) {
      this.handleRpcError(err)
      throw err
    }
  }

  async listTasks(projectId: string): Promise<readonly ManagedTaskDTO[]> {
    const current = this.getConnectionStatus()
    if (current === 'UNPAIRED') {
      throw new Error('Cannot list tasks: device is UNPAIRED')
    }
    if (current === 'OFFLINE') {
      throw new Error('Cannot list tasks: connection is OFFLINE')
    }
    try {
      const res = await this.rpcClient.request('managed.listTasks', { projectId })
      if (!res || typeof res !== 'object') {
        return []
      }
      this.authenticated = true
      this.authError = null
      const data = res as { tasks?: readonly ManagedTaskDTO[] }
      return data.tasks ?? []
    } catch (err) {
      this.handleRpcError(err)
      throw err
    }
  }

  async getEvidence(projectId: string, taskId: string): Promise<ManagedEvidenceDTO | null> {
    const current = this.getConnectionStatus()
    if (current === 'UNPAIRED') {
      throw new Error('Cannot get evidence: device is UNPAIRED')
    }
    if (current === 'OFFLINE') {
      throw new Error('Cannot get evidence: connection is OFFLINE')
    }
    try {
      const res = await this.rpcClient.request('managed.getEvidence', { projectId, taskId })
      if (!res || typeof res !== 'object') {
        return null
      }
      this.authenticated = true
      this.authError = null
      const data = res as { evidence?: ManagedEvidenceDTO }
      return data.evidence ?? null
    } catch (err) {
      this.handleRpcError(err)
      throw err
    }
  }

  private handleRpcError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err)
    if (
      msg.includes('AUTH_REQUIRED') ||
      msg.includes('UNAUTHORIZED') ||
      msg.includes('PENDING') ||
      msg.includes('INVALID_TOKEN') ||
      msg.includes('401')
    ) {
      this.authenticated = false
      this.authError = msg
    }
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
