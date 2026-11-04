import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadWindowsSecurity } from '../../shared/windows-security-addon'

// Purely synthetic QA: native global mutexes only, no FastAPI, WCB or ports.
// Each worker exits automatically after 20s if the test runner crashes.
const onlyWindows = process.platform === 'win32' ? describe : describe.skip

type Report = {
  state: 'HELD_BY_OTHER' | 'ACQUIRED_REQUIRES_RECONCILIATION'
  profileTag: string
  scope?: 'MACHINE'
  aclVerified?: boolean
  reconciliationRequired?: boolean
}

const fixture = path.resolve(
  process.cwd(), 'tests', 'fixtures', 'orca-gate9c2-lease-worker.cjs'
)

const workers: ChildProcess[] = []
const digest = () => createHash('sha256').update(randomUUID()).digest('hex')

function minimalEnvironment(profile: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ORCA_GATE9C2_TEST_ONLY: '1',
    ORCA_GATE9C2_PROFILE_TAG: profile
  }
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'Path', 'PATHEXT']) {
    if (process.env[key]) result[key] = process.env[key]
  }
  return result
}

async function startWorker(
  mode: 'hold' | 'probe',
  identity: string,
  profile: string
): Promise<{ child: ChildProcess; report: Report }> {
  const child = spawn(process.execPath, [fixture, mode, identity], {
    cwd: process.cwd(),
    shell: false,
    windowsHide: true,
    env: minimalEnvironment(profile),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  })
  workers.push(child)
  return new Promise((resolve, reject) => {
    let settled = false
    let output = ''
    let stderr = ''
    const deadline = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('GATE9C2_WORKER_OUTPUT_TIMEOUT: ' + stderr.slice(0, 1000)))
    }, 10000)
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
      const newline = output.indexOf('\n')
      if (newline === -1 || settled) return
      settled = true
      clearTimeout(deadline)
      try {
        resolve({ child, report: JSON.parse(output.slice(0, newline)) as Report })
      } catch {
        reject(new Error('GATE9C2_INVALID_WORKER_REPORT: ' + output.slice(0, 1000)))
      }
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      reject(error)
    })
    child.once('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      reject(new Error('GATE9C2_WORKER_EARLY_EXIT ' + code + ': ' + stderr.slice(0, 1000)))
    })
  })
}

async function stopWorker(child: ChildProcess, orderly: boolean): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })
  if (orderly) child.send?.('release')
  else child.kill() // only our own ChildProcess handle, never a discovered PID
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => {
      reject(new Error('GATE9C2_SYNTHETIC_OWNER_EXIT_TIMEOUT'))
    }, 8000)
    void exited.then(() => {
      clearTimeout(deadline)
      resolve()
    })
  })
}

onlyWindows('Gate 9B-C2 native Windows ownership between independent processes', () => {
  it('rejects a contender from another profile, and permits acquisition after normal release', async () => {
    const identity = digest()
    try {
      const first = await startWorker('hold', identity, 'desktop-profile-a')
      expect(first.report).toMatchObject({
        state: 'ACQUIRED_REQUIRES_RECONCILIATION',
        scope: 'MACHINE', aclVerified: true, reconciliationRequired: true
      })
      const contender = await startWorker('probe', identity, 'desktop-profile-b')
      expect(contender.report).toMatchObject({
        state: 'HELD_BY_OTHER', profileTag: 'desktop-profile-b'
      })
      await stopWorker(first.child, true)
      const successor = await startWorker('probe', identity, 'desktop-profile-b')
      expect(successor.report.state).toBe('ACQUIRED_REQUIRES_RECONCILIATION')
    } finally {
      await Promise.all(workers.splice(0).map((child) => stopWorker(child, false)))
    }
  }, 30000)

  it('releases the kernel lease after unexpected death, but demands reconciliation', async () => {
    const identity = digest()
    try {
      const owner = await startWorker('hold', identity, 'owner')
      expect(owner.report.state).toBe('ACQUIRED_REQUIRES_RECONCILIATION')
      const contender = await startWorker('probe', identity, 'contender')
      expect(contender.report.state).toBe('HELD_BY_OTHER')
      await stopWorker(owner.child, false)
      const successor = await startWorker('probe', identity, 'successor')
      expect(successor.report).toMatchObject({
        state: 'ACQUIRED_REQUIRES_RECONCILIATION',
        reconciliationRequired: true
      })
    } finally {
      await Promise.all(workers.splice(0).map((child) => stopWorker(child, false)))
    }
  }, 30000)

  it('allows independently named synthetic motor leases without collisions', async () => {
    const firstIdentity = digest()
    const secondIdentity = digest()
    try {
      const first = await startWorker('hold', firstIdentity, 'profile-a')
      const second = await startWorker('hold', secondIdentity, 'profile-b')
      expect(first.report.state).toBe('ACQUIRED_REQUIRES_RECONCILIATION')
      expect(second.report.state).toBe('ACQUIRED_REQUIRES_RECONCILIATION')
    } finally {
      await Promise.all(workers.splice(0).map((child) => stopWorker(child, false)))
    }
  }, 30000)

  it('rejects malformed identities and is idempotent on owner close', () => {
    const loaded = loadWindowsSecurity()
    if ('error' in loaded) throw new Error('GATE9C2_NATIVE_ADDON_LOAD_FAILED')
    expect(loaded.addon.hasNativeExport('acquireManagedMotorLease')).toBe(true)
    expect(() => loaded.addon.acquireManagedMotorLease('not-a-sha')).toThrow()
    const identity = digest()
    const first = loaded.addon.acquireManagedMotorLease(identity)
    expect(first.state).toBe('ACQUIRED_REQUIRES_RECONCILIATION')
    if (first.state !== 'ACQUIRED_REQUIRES_RECONCILIATION') return
    try {
      expect(first.lease.snapshot()).toMatchObject({
        held: true, aclVerified: true, scope: 'MACHINE',
        reconciliationRequired: true
      })
      expect(loaded.addon.acquireManagedMotorLease(identity).state).toBe('HELD_BY_OTHER')
    } finally {
      first.lease.close()
      first.lease.close()
    }
    expect(first.lease.snapshot().held).toBe(false)
    const next = loaded.addon.acquireManagedMotorLease(identity)
    expect(next.state).toBe('ACQUIRED_REQUIRES_RECONCILIATION')
    if (next.state === 'ACQUIRED_REQUIRES_RECONCILIATION') next.lease.close()
  })
})
