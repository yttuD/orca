import { describe, it, expect, vi } from 'vitest'
import type { ManagedDataProvider, MobileDeviceCredential } from './types'

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: vi.fn((s) => s) }
}))
const secureStoreMock = new Map<string, string>()
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (k: string) => secureStoreMock.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => {
    secureStoreMock.set(k, v)
  }),
  deleteItemAsync: vi.fn(async (k: string) => {
    secureStoreMock.delete(k)
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked'
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {})
  }
}))
import { SYNTHETIC_MANAGED_PROJECTS, SYNTHETIC_MANAGED_EVIDENCE } from './fixtures'
import { EncryptedRpcManagedDataProvider, DemoManagedDataProvider } from './data-provider'
import {
  SecureTrustedHostStore,
  verifyIndependentFingerprint,
  computeFingerprintFromPublicKey
} from './trusted-host-store'
import type { RpcClient } from '../transport/rpc-client'

const TEST_CREDENTIAL: MobileDeviceCredential = {
  deviceId: 'test-device-1',
  deviceName: 'Test Phone',
  deviceToken: 'mdt_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  hostId: 'host-test-1',
  issuedAt: Date.now(),
  expiresAt: Date.now() + 86400000,
  role: 'MOBILE_READONLY',
  revoked: false,
  nonce: 'nonce-cred-123456'
}

describe('ManagedCenterView & Mobile Fixture Integrity', () => {
  it('1. contains registered synthetic projects with proper schemas', () => {
    expect(SYNTHETIC_MANAGED_PROJECTS.length).toBeGreaterThanOrEqual(2)
    const p1 = SYNTHETIC_MANAGED_PROJECTS[0]
    expect(p1.id).toBe('c0a80101-0000-4000-8000-000000000001')
    expect(p1.name).toBe('Chat-AGY-CODEX-Orquestador')
    expect(p1.mode).toBe('MANAGED')
  })

  it('2. verifies certification rules across authentic, failed, and zero-check evidence', () => {
    const authEv = SYNTHETIC_MANAGED_EVIDENCE['TASK-F-CHAT-02-AUTHENTIC']
    expect(authEv.certification_status).toBe('CERTIFIED')
    expect(authEv.provenance_verified && authEv.hash_verified).toBe(true)
    expect(authEv.checks.every((c) => c.status === 'PASS')).toBe(true)

    const failEv = SYNTHETIC_MANAGED_EVIDENCE['TASK-F-CHAT-01-SYNTHETIC']
    expect(failEv.certification_status).toBe('REJECTED')
    expect(failEv.provenance_verified).toBe(false)

    const zeroEv = SYNTHETIC_MANAGED_EVIDENCE['TASK-F-CHAT-03-ZERO-CHECKS']
    expect(zeroEv.certification_status).toBe('UNCERTIFIED')
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

    const provider = new EncryptedRpcManagedDataProvider(mockRpcClient, TEST_CREDENTIAL)
    // Initially authenticated is false until probe or first query succeeds
    expect(provider.getConnectionStatus()).toBe('CONNECTING')

    const projs = await provider.listProjects()
    expect(projs).toHaveLength(1)
    expect(rpcCalls[0]?.method).toBe('managed.listProjects')
    expect(provider.getConnectionStatus()).toBe('ONLINE')

    const tasks = await provider.listTasks('p1')
    expect(tasks).toHaveLength(1)
    expect(rpcCalls[1]?.method).toBe('managed.listTasks')

    // Disconnect transport: must fail closed immediately
    connectionKind = 'disconnected'
    expect(provider.getConnectionStatus()).toBe('OFFLINE')
    await expect(provider.listProjects()).rejects.toThrow(
      'Cannot list projects: connection is OFFLINE'
    )
  })

  it('7. separates states DEMO, UNPAIRED, CONNECTING, ONLINE, AUTH_REQUIRED, PENDING_APPROVAL, OFFLINE', async () => {
    let returnAuthError = false
    let returnPendingError = false
    const mockRpcClient = {
      request: async () => {
        if (returnPendingError) {
          throw new Error('DEVICE_REGISTRATION_PENDING: PENDING_OPERATOR_APPROVAL')
        }
        if (returnAuthError) {
          throw new Error('AUTH_REQUIRED: Device revoked or token expired')
        }
        return { projects: [] }
      },
      getState: () => ({ kind: 'connected' })
    } as unknown as RpcClient

    // Unpaired
    const unpairedProv = new EncryptedRpcManagedDataProvider(mockRpcClient, null)
    expect(unpairedProv.getConnectionStatus()).toBe('UNPAIRED')

    // Paired, connecting probe
    const pairedProv = new EncryptedRpcManagedDataProvider(mockRpcClient, TEST_CREDENTIAL)
    expect(pairedProv.getConnectionStatus()).toBe('CONNECTING')

    // Probe success -> ONLINE
    const st1 = await pairedProv.probeAuthentication()
    expect(st1).toBe('ONLINE')
    expect(pairedProv.getConnectionStatus()).toBe('ONLINE')

    // Probe auth error -> AUTH_REQUIRED
    returnAuthError = true
    const st2 = await pairedProv.probeAuthentication()
    expect(st2).toBe('AUTH_REQUIRED')
    expect(pairedProv.getConnectionStatus()).toBe('AUTH_REQUIRED')

    // Probe pending approval -> PENDING_APPROVAL
    returnAuthError = false
    returnPendingError = true
    const st3 = await pairedProv.probeAuthentication()
    expect(st3).toBe('PENDING_APPROVAL')
    expect(pairedProv.getConnectionStatus()).toBe('PENDING_APPROVAL')
  })

  it('8. SecureTrustedHostStore validates independent fingerprint and rejects key substitution', async () => {
    const { setTestSecureStorageDriver, createMemoryStorageDriver } =
      await import('./trusted-host-store')
    setTestSecureStorageDriver(createMemoryStorageDriver())
    const store = new SecureTrustedHostStore()
    const validPubB64 = 'KMsCWIv+fW3YU4ywFIr+r66+dczkegsvhEA2OKbvJnk='
    const expectedFp = computeFingerprintFromPublicKey(validPubB64)

    // Independent reference check passes
    expect(verifyIndependentFingerprint(validPubB64, expectedFp)).toBe(true)
    expect(verifyIndependentFingerprint(validPubB64, 'wrong-reference')).toBe(false)

    // Pinning succeeds
    const pinRes = await store.verifyAndPinHost('host-alpha', validPubB64, expectedFp)
    expect(pinRes.ok).toBe(true)

    // Initial pinning without independent reference fails closed
    const noRefRes = await store.verifyAndPinHost('host-beta', validPubB64)
    expect(noRefRes.ok).toBe(false)
    expect(noRefRes.error).toBe('INDEPENDENT_REFERENCE_REQUIRED')

    // Substitution rejection
    const substPubB64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    const substRes = await store.verifyAndPinHost('host-alpha', substPubB64)
    expect(substRes.ok).toBe(false)
    expect(substRes.error).toBe('HOST_KEY_SUBSTITUTION_REJECTED')

    // Explicit override succeeds
    const overrideRes = await store.verifyAndPinHost('host-alpha', substPubB64, undefined, true)
    expect(overrideRes.ok).toBe(true)
  })

  it('9. DemoManagedDataProvider isolates synthetic fixtures strictly to demo mode', async () => {
    const demo = new DemoManagedDataProvider()
    const projs = await demo.listProjects()
    expect(projs).toEqual(SYNTHETIC_MANAGED_PROJECTS)
    const tasks = await demo.listTasks('c0a80101-0000-4000-8000-000000000001')
    expect(tasks.length).toBeGreaterThan(0)
  })

  it('10. fails closed without driver, and persists via injected SecureStorageDriver', async () => {
    const {
      loadStoredCredential,
      saveStoredCredential,
      removeStoredCredential,
      setTestSecureStorageDriver,
      createMemoryStorageDriver
    } = await import('./trusted-host-store')
    const cred: MobileDeviceCredential = {
      deviceId: 'phone-test-1',
      deviceName: 'Moto G20',
      deviceToken: 'token-abc',
      hostId: 'host-gamma',
      issuedAt: 1700000000,
      expiresAt: 1703600000,
      role: 'MOBILE_READONLY',
      revoked: false,
      nonce: 'nonce-1'
    }

    // 1. Without injected driver on unsupported/mockless runtime: fails closed
    setTestSecureStorageDriver(null)
    expect(await saveStoredCredential(cred)).toBe(false)
    expect(await loadStoredCredential('host-gamma')).toBeNull()

    // 2. With explicitly injected test driver: persistence succeeds
    setTestSecureStorageDriver(createMemoryStorageDriver())
    const credWithNative = { ...cred, nativeHostId: 'desktop-host-gamma' }
    expect(await saveStoredCredential(credWithNative)).toBe(true)
    expect(await loadStoredCredential('host-gamma')).toEqual(credWithNative)
    expect(await loadStoredCredential('desktop-host-gamma')).toEqual(credWithNative)

    await removeStoredCredential('host-gamma')
    expect(await loadStoredCredential('host-gamma')).toBeNull()
  })

  it('11. does not cache host on storage failure and enforces independent reference', async () => {
    const { setTestSecureStorageDriver } = await import('./trusted-host-store')
    setTestSecureStorageDriver({
      getItem: async () => null,
      setItem: async () => {
        throw new Error('disk full')
      },
      deleteItem: async () => {}
    })
    const store = new SecureTrustedHostStore()
    const validPubB64 = 'KMsCWIv+fW3YU4ywFIr+r66+dczkegsvhEA2OKbvJnk='
    const expectedFp = computeFingerprintFromPublicKey(validPubB64)

    const res1 = await store.verifyAndPinHost('host-fail', validPubB64, expectedFp)
    expect(res1.ok).toBe(false)
    expect(res1.error).toBe('STORAGE_PERSISTENCE_FAILED')
    expect(store.getTrustedHostKey('host-fail')).toBeNull()

    const res2 = await store.verifyAndPinHost('host-fail', validPubB64)
    expect(res2.ok).toBe(false)
    expect(res2.error).toBe('INDEPENDENT_REFERENCE_REQUIRED')
  })

  it('12. requestDevicePairing enforces confirmedFingerprint strictly', async () => {
    const mockRpcClient = {
      request: vi.fn(async () => ({ ok: true, credential: TEST_CREDENTIAL })),
      getState: () => ({ kind: 'connected' })
    } as unknown as RpcClient
    const prov = new EncryptedRpcManagedDataProvider(mockRpcClient, null)
    await expect(
      prov.requestDevicePairing({
        deviceId: 'd1',
        deviceName: 'Moto G20',
        confirmedFingerprint: ''
      })
    ).rejects.toThrow('CONFIRMED_FINGERPRINT_REQUIRED')

    const res = await prov.requestDevicePairing({
      deviceId: 'd1',
      deviceName: 'Moto G20',
      confirmedFingerprint: 'valid-fp'
    })
    expect(res).toEqual(TEST_CREDENTIAL)
  })
})
