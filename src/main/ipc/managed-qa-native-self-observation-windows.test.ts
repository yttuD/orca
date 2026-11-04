import { createHash, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadWindowsSecurity } from '../../shared/windows-security-addon'
import type { ManagedMotorLeaseHandle } from '../../../native/windows-security'
import {
  inspectCurrentQaProcessUnderNativeLease
} from './managed-qa-native-self-observation'

// Gate C4-B2-A is strictly for this QA Vitest Node process, its own native
// motor-identity mutex, and its own 127.0.0.1 port allocated by Windows.
// No operational listener, foreign PID, FastAPI, WCB or arbitrary port scan.
const windowsOnly = process.platform === 'win32' ? describe : describe.skip

let oldOptIn: string | undefined
const held: ManagedMotorLeaseHandle[] = []
const servers: Server[] = []

function addon() {
  const result = loadWindowsSecurity()
  if ('error' in result) throw new Error('GATE9C4B2_NATIVE_NOT_AVAILABLE')
  return result.addon
}

function acquire(): { lease: ManagedMotorLeaseHandle; hash: string } {
  const hash = createHash('sha256').update(randomUUID()).digest('hex')
  const result = addon().acquireManagedMotorLease(hash)
  if (result.state !== 'ACQUIRED_REQUIRES_RECONCILIATION') {
    throw new Error('GATE9C4B2_SYNTHETIC_LEASE_BUSY')
  }
  held.push(result.lease)
  return { lease: result.lease, hash }
}

async function localServer(): Promise<Server> {
  const server = createServer((socket) => socket.destroy())
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return server
}

async function closeOwnServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()))
}

windowsOnly('Gate 9B-C4-B2-A — native self-observation under synthetic QA lease', () => {
  beforeEach(() => {
    oldOptIn = process.env.ORCA_GATE9C4B2_TEST_ONLY
    process.env.ORCA_GATE9C4B2_TEST_ONLY = '1'
  })

  afterEach(async () => {
    for (const server of servers.splice(0)) await closeOwnServer(server)
    for (const lease of held.splice(0)) lease.close()
    if (oldOptIn === undefined) delete process.env.ORCA_GATE9C4B2_TEST_ONLY
    else process.env.ORCA_GATE9C4B2_TEST_ONLY = oldOptIn
  })

  it('gets real native own-PID FILETIME, lease and local listener yet never allows startup', async () => {
    const { lease, hash } = acquire()
    const server = await localServer()
    const generation = randomUUID()
    const result = inspectCurrentQaProcessUnderNativeLease(lease, hash, generation, server)
    expect(result).toMatchObject({
      status: 'BLOCKED',
      startupAllowed: false,
      historicalProof: false,
      observationKind: 'CURRENT_QA_PROCESS_ONLY',
      lease: 'LIVE_NATIVE_HANDLE_OBSERVED',
      listener: 'OWN_LOOPBACK_LISTENER_PRESENT',
      recordedProcess: 'OWN_PROCESS_MATCH_RUNNING',
      owner: { generationId: generation, pid: process.pid }
    })
    if (result.observationKind !== 'CURRENT_QA_PROCESS_ONLY') return
    expect(result.owner.creationTimeTicks).toMatch(/^[1-9][0-9]{11,19}$/)
    expect(server.listening).toBe(true)
    expect(lease.snapshot().held).toBe(true)
    expect(JSON.stringify(result)).not.toContain(process.execPath)
  })

  it('rejects an object with a cloned native lease prototype and does not inspect other PIDs', async () => {
    const { lease, hash } = acquire()
    const server = await localServer()
    const forged = Object.create(Object.getPrototypeOf(lease)) as ManagedMotorLeaseHandle
    const result = inspectCurrentQaProcessUnderNativeLease(
      forged, hash, randomUUID(), server
    )
    expect(result).toEqual({
      status: 'BLOCKED',
      startupAllowed: false,
      historicalProof: false,
      observationKind: 'UNKNOWN',
      reason: 'NATIVE_LEASE_NOT_VERIFIED'
    })
    expect(lease.snapshot().held).toBe(true)
  })

  it('refuses a native lease once its original owner has released it', async () => {
    const { lease, hash } = acquire()
    const server = await localServer()
    lease.close()
    expect(inspectCurrentQaProcessUnderNativeLease(
      lease, hash, randomUUID(), server
    )).toMatchObject({
      status: 'BLOCKED',
      observationKind: 'UNKNOWN',
      reason: 'NATIVE_LEASE_NOT_VERIFIED'
    })
  })

  it('refuses a different motor hash even with a valid live native lease', async () => {
    const { lease } = acquire()
    const server = await localServer()
    expect(inspectCurrentQaProcessUnderNativeLease(
      lease, 'f'.repeat(64), randomUUID(), server
    )).toMatchObject({
      status: 'BLOCKED',
      observationKind: 'UNKNOWN',
      reason: 'NATIVE_LEASE_NOT_VERIFIED'
    })
  })

  it('rejects invalid generation and digest before any native sensor read', async () => {
    const { lease, hash } = acquire()
    const server = await localServer()
    expect(inspectCurrentQaProcessUnderNativeLease(lease, hash, 'invalid', server))
      .toMatchObject({ observationKind: 'UNKNOWN', reason: 'INVALID_QA_IDENTITY' })
    expect(inspectCurrentQaProcessUnderNativeLease(lease, 'not-a-hash', randomUUID(), server))
      .toMatchObject({ observationKind: 'UNKNOWN', reason: 'INVALID_QA_IDENTITY' })
  })

  it('refuses observation without the explicit QA opt-in', async () => {
    const { lease, hash } = acquire()
    const server = await localServer()
    delete process.env.ORCA_GATE9C4B2_TEST_ONLY
    expect(inspectCurrentQaProcessUnderNativeLease(
      lease, hash, randomUUID(), server
    )).toMatchObject({
      status: 'BLOCKED',
      reason: 'QA_ENVIRONMENT_NOT_ALLOWED',
      observationKind: 'UNKNOWN'
    })
  })

  it('refuses a server that stopped listening instead of claiming no listener', async () => {
    const { lease, hash } = acquire()
    const server = await localServer()
    await closeOwnServer(server)
    expect(inspectCurrentQaProcessUnderNativeLease(
      lease, hash, randomUUID(), server
    )).toMatchObject({
      status: 'BLOCKED',
      reason: 'QA_LISTENER_NOT_OWNED_OR_NOT_LOOPBACK',
      observationKind: 'UNKNOWN'
    })
  })

  it('never emits a previous-motor absence claim or executable path in the native report', async () => {
    const { lease, hash } = acquire()
    const server = await localServer()
    const result = inspectCurrentQaProcessUnderNativeLease(
      lease, hash, randomUUID(), server
    )
    expect(result.observationKind).toBe('CURRENT_QA_PROCESS_ONLY')
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('NO_OLD_OWNER')
    expect(serialized).not.toContain('NO_REMAINDER')
    expect(serialized).not.toContain('READY_FOR')
    expect(serialized).not.toContain('executablePath')
    expect(serialized).not.toContain('password')
    expect(result.startupAllowed).toBe(false)
    expect(result.historicalProof).toBe(false)
  })
})
