import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { MANAGED_RPC_METHODS } from './managed'
import * as managedResolver from '../../../ipc/managed-resolver'

vi.mock('../../../ipc/managed-resolver', () => ({
  callEngineRpc: vi.fn(),
  resolveProfileAndToken: vi.fn(() => ({
    profile: 'NORMAL',
    port: 8765,
    token: 'mbt_mock',
    engineUrl: 'http://127.0.0.1:8765/api/managed/rpc'
  })),
  resolveBridgeToken: vi.fn(() => 'mbt_mock')
}))

function dispatchManaged(
  method: string,
  params: unknown = {},
  ctx: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const runtime = { getRuntimeId: () => 'test-runtime' }
    const dispatcher = new RpcDispatcher({
      runtime: runtime as unknown as OrcaRuntimeService,
      methods: MANAGED_RPC_METHODS
    })
    void dispatcher.dispatchStreaming(
      { id: 'request-1', authToken: '', method, params },
      (response) => resolve(JSON.parse(response) as Record<string, unknown>),
      ctx
    )
  })
}

describe('Managed RPC Methods on Orca Desktop Main', () => {
  it('1. lists projects by querying engine loopback via callEngineRpc', async () => {
    const mockProjects = [
      { id: 'proj-1', name: 'Chat-AGY-CODEX-Orquestador', status: 'ACTIVE', mode: 'MANAGED' }
    ]
    vi.mocked(managedResolver.callEngineRpc).mockResolvedValueOnce({
      ok: true,
      data: { projects: mockProjects }
    })

    const res = await dispatchManaged('managed.listProjects', {})
    expect(res.ok).toBe(true)
    expect(res.result).toEqual({ projects: mockProjects })
    expect(managedResolver.callEngineRpc).toHaveBeenCalledWith(
      'managed.listProjects',
      {},
      undefined
    )
  })

  it('2. lists tasks with project_id parameter normalization', async () => {
    const mockTasks = [{ id: 'task-1', project_id: 'proj-1', title: 'Task 1', status: 'COMPLETED' }]
    vi.mocked(managedResolver.callEngineRpc).mockResolvedValueOnce({
      ok: true,
      data: { tasks: mockTasks }
    })

    const res = await dispatchManaged('managed.listTasks', { projectId: 'proj-1' })
    expect(res.ok).toBe(true)
    expect(res.result).toEqual({ tasks: mockTasks })
    expect(managedResolver.callEngineRpc).toHaveBeenCalledWith(
      'managed.listTasks',
      { project_id: 'proj-1' },
      undefined
    )
  })

  it('3. retrieves evidence with project_id and task_id parameters', async () => {
    const mockEvidence = {
      project_id: 'proj-1',
      task_id: 'task-1',
      provenance: 'AUTHENTIC',
      provenance_verified: true,
      certification_status: 'CERTIFIED'
    }
    vi.mocked(managedResolver.callEngineRpc).mockResolvedValueOnce({
      ok: true,
      data: { evidence: mockEvidence }
    })

    const res = await dispatchManaged('managed.getEvidence', {
      projectId: 'proj-1',
      taskId: 'task-1'
    })
    expect(res.ok).toBe(true)
    expect(res.result).toEqual({ evidence: mockEvidence })
    expect(managedResolver.callEngineRpc).toHaveBeenCalledWith(
      'managed.getEvidence',
      { project_id: 'proj-1', task_id: 'task-1' },
      undefined
    )
  })

  it('4. extracts and forwards mobile caller auth headers', async () => {
    vi.mocked(managedResolver.callEngineRpc).mockResolvedValueOnce({
      ok: true,
      data: { projects: [] }
    })

    const auth = {
      deviceId: 'mobile-phone-1',
      deviceToken: 'tok-abc-123',
      nonce: 'nonce-req-001',
      timestamp: 1700000000
    }

    const res = await dispatchManaged('managed.listProjects', { _auth: auth })
    expect(res.ok).toBe(true)
    expect(managedResolver.callEngineRpc).toHaveBeenCalledWith(
      'managed.listProjects',
      {},
      {
        surface: 'mobile',
        deviceId: 'mobile-phone-1',
        deviceToken: 'tok-abc-123',
        nonce: 'nonce-req-001',
        timestamp: 1700000000
      }
    )
  })

  it('5. fails closed when engine RPC returns error', async () => {
    vi.mocked(managedResolver.callEngineRpc).mockResolvedValueOnce({
      ok: false,
      error_code: 'ENGINE_OFFLINE',
      error_message: 'Engine connection refused'
    })

    const res = await dispatchManaged('managed.listProjects', {})
    expect(res.ok).toBe(false)
    expect(res.error).toBeDefined()
  })

  it('6. contains strictly positive allowlist of 6 methods, zero mutations', () => {
    const methodNames = MANAGED_RPC_METHODS.map((m) => m.name)
    expect(methodNames).toEqual([
      'managed.listProjects',
      'managed.listTasks',
      'managed.getExecution',
      'managed.getEvidence',
      'managed.presentReviewPacket',
      'managed.listActivity'
    ])
    expect(methodNames).not.toContain('managed.requestDispatch')
    expect(methodNames).not.toContain('managed.approveVerdict')
    expect(methodNames).not.toContain('managed.requestPause')
    expect(methodNames).not.toContain('managed.requestStop')
  })

  it('7. strictly binds deviceId to transport ctx.pairedDeviceId and rejects spoofing', async () => {
    const res = await dispatchManaged(
      'managed.listProjects',
      { _auth: { deviceId: 'spoofed-id' } },
      { clientKind: 'mobile', pairedDeviceId: 'authenticated-id' }
    )
    expect(res.ok).toBe(false)
    expect(JSON.stringify(res.error)).toContain('DEVICE_IDENTITY_SPOOF_REJECTED')
  })

  it('8. prioritizes ctx.pairedDeviceId over omitted client deviceId', async () => {
    vi.mocked(managedResolver.callEngineRpc).mockResolvedValueOnce({
      ok: true,
      data: { projects: [] }
    })
    const res = await dispatchManaged(
      'managed.listProjects',
      { _auth: { deviceToken: 'tok-123' } },
      { clientKind: 'mobile', pairedDeviceId: 'authenticated-id' }
    )
    expect(res.ok).toBe(true)
    expect(managedResolver.callEngineRpc).toHaveBeenCalledWith(
      'managed.listProjects',
      {},
      expect.objectContaining({ deviceId: 'authenticated-id', deviceToken: 'tok-123' })
    )
  })
})
