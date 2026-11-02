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

function generateCsprngHex(byteLength = 16): string {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(byteLength)
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  throw new Error('CSPRNG_UNAVAILABLE')
}

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
      if (
        this.authError.includes('PENDING_APPROVAL') ||
        this.authError.includes('PENDING_OPERATOR_APPROVAL') ||
        this.authError.toUpperCase().includes('PENDING')
      ) {
        return 'PENDING_APPROVAL'
      }
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

  private createAuthPayload(): Record<string, unknown> | undefined {
    if (!this.credential) {
      return undefined
    }
    return {
      deviceId: this.credential.deviceId,
      deviceToken: this.credential.deviceToken,
      nonce: `req-nonce-${Date.now()}-${generateCsprngHex(16)}`,
      timestamp: Math.floor(Date.now() / 1000)
    }
  }

  private async executeRpc(method: string, params: unknown): Promise<unknown> {
    const client = this.rpcClient as unknown as {
      sendRequest?: (
        m: string,
        p?: unknown
      ) => Promise<{ ok: boolean; result?: unknown; error?: { message?: string; code?: string } }>
      request?: (m: string, p?: unknown) => Promise<unknown>
    }
    if (typeof client.sendRequest === 'function') {
      const resp = await client.sendRequest(method, params)
      if (!resp.ok) {
        const err = resp.error ?? {}
        throw new Error(String(err.message || err.code || 'RPC_FAILED'))
      }
      return resp.result
    }
    if (typeof client.request === 'function') {
      return client.request(method, params)
    }
    throw new Error('Unsupported RpcClient implementation')
  }

  async probeAuthentication(): Promise<MobileConnectionStatus> {
    if (!this.credential) {
      this.authenticated = false
      return 'UNPAIRED'
    }
    if (this.credential.revoked) {
      this.authenticated = false
      return 'AUTH_REQUIRED'
    }
    if (Date.now() > this.credential.expiresAt) {
      this.authenticated = false
      return 'AUTH_REQUIRED'
    }
    const state = this.rpcClient.getState()
    if (state.kind !== 'connected') {
      this.authenticated = false
      return state.kind === 'connecting' ? 'CONNECTING' : 'OFFLINE'
    }

    try {
      const auth = this.createAuthPayload()
      const params = auth ? { _auth: auth } : {}
      await this.executeRpc('managed.listProjects', params)
      this.authenticated = true
      this.authError = null
      return 'ONLINE'
    } catch (err: unknown) {
      this.handleRpcError(err)
      return this.getConnectionStatus()
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
    if (current === 'AUTH_REQUIRED') {
      throw new Error('Cannot list projects: device authentication required')
    }
    try {
      const auth = this.createAuthPayload()
      const params = auth ? { _auth: auth } : {}
      const res = await this.executeRpc('managed.listProjects', params)
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
    if (current === 'AUTH_REQUIRED') {
      throw new Error('Cannot list tasks: device authentication required')
    }
    try {
      const auth = this.createAuthPayload()
      const params = { projectId, ...(auth ? { _auth: auth } : {}) }
      const res = await this.executeRpc('managed.listTasks', params)
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
    if (current === 'AUTH_REQUIRED') {
      throw new Error('Cannot get evidence: device authentication required')
    }
    try {
      const auth = this.createAuthPayload()
      const params = { projectId, taskId, ...(auth ? { _auth: auth } : {}) }
      const res = await this.executeRpc('managed.getEvidence', params)
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

  async requestDevicePairing(options: {
    offerId?: string
    deviceId: string
    deviceName: string
    confirmedFingerprint?: string
  }): Promise<MobileDeviceCredential> {
    const clientNonce = `cnonce-${Date.now()}-${generateCsprngHex(8)}`
    const params = {
      offerId: options.offerId,
      deviceId: options.deviceId,
      deviceName: options.deviceName,
      clientNonce,
      confirmedFingerprint: options.confirmedFingerprint
    }
    const res = (await this.executeRpc('managed.registerDevice', params)) as {
      ok: boolean
      credential?: MobileDeviceCredential
    }
    if (!res || !res.credential) {
      throw new Error('DEVICE_REGISTRATION_FAILED')
    }
    return res.credential
  }

  private handleRpcError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err)
    if (
      msg.includes('AUTH_REQUIRED') ||
      msg.includes('UNAUTHORIZED') ||
      msg.includes('PENDING') ||
      msg.includes('INVALID_TOKEN') ||
      msg.includes('REVOKED') ||
      msg.includes('REPLAY') ||
      msg.includes('FORBIDDEN') ||
      msg.includes('401')
    ) {
      this.authenticated = false
      this.authError = msg
    }
  }
}

export class MockManagedDataProvider implements ManagedDataProvider {
  async listProjects(): Promise<readonly ManagedProjectDTO[]> {
    return SYNTHETIC_MANAGED_PROJECTS
  }

  async listTasks(projectId: string): Promise<readonly ManagedTaskDTO[]> {
    return SYNTHETIC_MANAGED_TASKS[projectId] ?? []
  }

  async getEvidence(projectId: string, taskId: string): Promise<ManagedEvidenceDTO | null> {
    return (
      SYNTHETIC_MANAGED_EVIDENCE.find((e) => e.project_id === projectId && e.task_id === taskId) ??
      null
    )
  }

  getConnectionStatus(): MobileConnectionStatus {
    return 'ONLINE'
  }
}

export const DemoManagedDataProvider = MockManagedDataProvider
