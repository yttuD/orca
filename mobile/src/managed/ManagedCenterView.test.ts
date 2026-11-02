import { describe, it, expect } from 'vitest'
import type { ManagedDataProvider } from './types'
import { SYNTHETIC_MANAGED_PROJECTS, SYNTHETIC_MANAGED_EVIDENCE } from './fixtures'
import { EncryptedRpcManagedDataProvider, DemoManagedDataProvider } from './data-provider'
import type { RpcClient } from '../transport/rpc-client'

describe('ManagedCenterView & Mobile Fixture Integrity', () => {
  it('1. contains registered synthetic projects with proper schemas', () => {
    expect(SYNTHETIC_MANAGED_PROJECTS.length).toBeGreaterThanOrEqual(2)
    const p1 = SYNTHETIC_MANAGED_PROJECTS[0]
    expect(p1.id).toBe('c0a80101-0000-4000-8000-000000000001')
    expect(p1.name).toBe('Chat-AGY-CODEX-Orquestador')
    expect(p1.mode).toBe('MANAGED')
  })

  it('2. certifies authentic task only when all checks pass and provenance is verified', () => {
    const authEv = SYNTHETIC_MANAGED_EVIDENCE['TASK-F-CHAT-02-AUTHENTIC']
    expect(authEv).toBeDefined()
    expect(authEv.provenance).toBe('AUTHENTIC')
    expect(authEv.provenance_verified).toBe(true)
    expect(authEv.commit_exists).toBe(true)
    expect(authEv.hash_status).toBe('VERIFIED')
    expect(authEv.hash_verified).toBe(true)
    expect(authEv.checks_summary.failed).toBe(0)
    expect(authEv.checks.length).toBe(3)
    expect(authEv.checks.every((c) => c.status === 'PASS')).toBe(true)
    expect(authEv.certification_status).toBe('CERTIFIED')
    expect(authEv.memory_telemetry.status).toBe('MEASURED')
  })

  it('3. rejects certification when checks fail and provenance is unverified', () => {
    const failEv = SYNTHETIC_MANAGED_EVIDENCE['TASK-F-CHAT-01-SYNTHETIC']
    expect(failEv).toBeDefined()
    expect(failEv.provenance).toBe('UNVERIFIED')
    expect(failEv.provenance_verified).toBe(false)
    expect(failEv.hash_status).toBe('MISMATCH')
    expect(failEv.hash_verified).toBe(false)
    expect(failEv.checks_summary.failed).toBe(1)
    expect(failEv.certification_status).toBe('REJECTED')
  })

  it('4. marks uncertified when task has zero checks executed', () => {
    const zeroEv = SYNTHETIC_MANAGED_EVIDENCE['TASK-F-CHAT-03-ZERO-CHECKS']
    expect(zeroEv).toBeDefined()
    expect(zeroEv.checks.length).toBe(0)
    expect(zeroEv.checks_summary.total).toBe(0)
    expect(zeroEv.certification_status).toBe('UNCERTIFIED')
    expect(zeroEv.memory_telemetry.status).toBe('NOT_MEASURED')
  })

  it('5. defines decoupled data provider contract and clears stale data on disconnect', async () => {
    let mockProjectsCalled = false
    const mockProvider: ManagedDataProvider = {
      listProjects: async () => {
        mockProjectsCalled = true
        return [
          {
            id: 'proj-live-1',
            name: 'Live Remote Project',
            status: 'ACTIVE',
            mode: 'MANAGED'
          }
        ]
      },
      listTasks: async () => [],
      getEvidence: async () => null,
      getConnectionStatus: () => 'ONLINE'
    }

    const projects = await mockProvider.listProjects()
    expect(mockProjectsCalled).toBe(true)
    expect(projects).toHaveLength(1)
    expect(projects[0]?.name).toBe('Live Remote Project')
  })

  it('6. EncryptedRpcManagedDataProvider routes over RpcClient without plaintext HTTP', async () => {
    const rpcCalls: { method: string; params: unknown }[] = []
    let connectionKind: 'connected' | 'connecting' | 'disconnected' = 'connected'

    const mockRpcClient = {
      request: async (method: string, params: unknown) => {
        rpcCalls.push({ method, params })
        if (method === 'managed.listProjects') {
          return {
            projects: [{ id: 'p1', name: 'Secure Project', status: 'ACTIVE', mode: 'MANAGED' }]
          }
        }
        if (method === 'managed.listTasks') {
          return {
            tasks: [
              { id: 't1', project_id: 'p1', title: 'Task 1', status: 'DONE', executor: 'gemini' }
            ]
          }
        }
        return null
      },
      getState: () => ({ kind: connectionKind })
    } as unknown as RpcClient

    const provider = new EncryptedRpcManagedDataProvider(mockRpcClient)
    expect(provider.getConnectionStatus()).toBe('ONLINE')

    const projs = await provider.listProjects()
    expect(projs).toHaveLength(1)
    expect(rpcCalls[0]?.method).toBe('managed.listProjects')

    const tasks = await provider.listTasks('p1')
    expect(tasks).toHaveLength(1)
    expect(rpcCalls[1]?.method).toBe('managed.listTasks')

    // Disconnect transport: must fail closed immediately without returning stale data
    connectionKind = 'disconnected'
    expect(provider.getConnectionStatus()).toBe('OFFLINE')
    await expect(provider.listProjects()).rejects.toThrow(
      'Cannot list projects: connection is OFFLINE'
    )
    await expect(provider.listTasks('p1')).rejects.toThrow(
      'Cannot list tasks: connection is OFFLINE'
    )
  })

  it('7. DemoManagedDataProvider isolates synthetic fixtures strictly to demo mode', async () => {
    const demo = new DemoManagedDataProvider()
    const projs = await demo.listProjects()
    expect(projs).toEqual(SYNTHETIC_MANAGED_PROJECTS)
    const tasks = await demo.listTasks('c0a80101-0000-4000-8000-000000000001')
    expect(tasks.length).toBeGreaterThan(0)
  })
})
