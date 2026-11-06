import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  trustedWindow: vi.fn(),
  callEngineRpc: vi.fn(),
  resolveProfileAndToken: vi.fn(),
  snapshot: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  listActivity: vi.fn(),
  unregMutations: vi.fn()
}))

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) =>
      mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel)
  }
}))
vi.mock('./managed-qa-engine-supervisor', () => ({
  gate9QaEnabled: () => false,
  qaEngineSupervisor: {
    snapshot: mocks.snapshot,
    start: mocks.start,
    stop: mocks.stop
  }
}))
vi.mock('./managed-resolver', () => ({
  callEngineRpc: mocks.callEngineRpc,
  resolveProfileAndToken: mocks.resolveProfileAndToken,
  resolveBridgeToken: () => null
}))
vi.mock('./managed-mutation-handlers', () => ({
  trustedDesktopWindow: mocks.trustedWindow,
  registerManagedMutationHandlers: () => mocks.unregMutations
}))
vi.mock('./managed-mutations', () => ({}))
vi.mock('./managed-activity', () => ({
  fetchManagedActivityFromEngine: mocks.listActivity
}))
vi.mock('./managed-edge-health', () => ({
  probeEdgeBridgeHealth: vi.fn()
}))

import { registerManagedHandlers } from './managed'

function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error('Missing IPC handler: ' + channel)
  return Promise.resolve(handler({ sender: 'untrusted-child-frame' }, ...args))
}

const readChannels: Array<{ channel: string; args: unknown[]; emptyKey?: string }> = [
  { channel: 'managed:listProjects', args: [], emptyKey: 'projects' },
  { channel: 'managed:status', args: [] },
  { channel: 'managed:listTasks', args: ['private-project'], emptyKey: 'tasks' },
  { channel: 'managed:getExecution', args: ['private-project', 'task'] },
  { channel: 'managed:getEvidence', args: ['private-project', 'task'] },
  { channel: 'managed:presentReviewPacket', args: ['private-project', 'task'] },
  { channel: 'managed:listActivity', args: ['private-project', 'task'], emptyKey: 'activities' }
]

describe('Orcastrator Desktop managed read IPC trust boundary', () => {
  let cleanup: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.trustedWindow.mockReturnValue(null)
    mocks.callEngineRpc.mockResolvedValue({ ok: true, data: { projects: [{ name: 'SECRET' }] } })
    mocks.resolveProfileAndToken.mockReturnValue({ profile: 'STAGING_LOCAL' })
    mocks.snapshot.mockReturnValue({ phase: 'ONLINE', owner: 'THIS_ELECTRON', port: 18765, restarts: 0 })
    cleanup = registerManagedHandlers()
  })

  afterEach(() => cleanup())

  it('rejects all seven managed read channels from untrusted frames', async () => {
    for (const { channel, args, emptyKey } of readChannels) {
      const result = await invoke(channel, ...args)
      expect(result).toMatchObject({
        ok: false, status: 'ERROR', error_code: 'DESKTOP_OPERATOR_REQUIRED'
      })
      expect(JSON.stringify(result)).not.toContain('SECRET')
      if (emptyKey) expect(result[emptyKey]).toEqual([])
    }
    expect(mocks.callEngineRpc).not.toHaveBeenCalled()
    expect(mocks.listActivity).not.toHaveBeenCalled()
    expect(mocks.resolveProfileAndToken).not.toHaveBeenCalled()
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })

  it('does not expose an active local QA lifecycle from untrusted status IPC', async () => {
    const result = await invoke('managed:status')
    expect(result.qa_lifecycle).toEqual({
      phase: 'DISABLED', owner: 'NONE', port: null, restarts: 0
    })
    expect(result.profile).toBe('NORMAL')
  })

  it('preserves valid managed reads from an authorized main Desktop frame', async () => {
    mocks.trustedWindow.mockReturnValue({ trusted: true })
    const projects = await invoke('managed:listProjects')
    expect(projects).toMatchObject({
      ok: true, projects: [{ name: 'SECRET' }]
    })
    expect(mocks.callEngineRpc).toHaveBeenCalledWith('managed.listProjects', {})
    const status = await invoke('managed:status')
    expect(status).toMatchObject({
      ok: true, profile: 'STAGING_LOCAL',
      qa_lifecycle: { phase: 'ONLINE' }
    })
  })
})
