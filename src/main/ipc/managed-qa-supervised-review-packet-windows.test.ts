import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ManagedMotorLeaseHandle } from '../../../native/windows-security'
import { loadWindowsSecurity } from '../../shared/windows-security-addon'
import {
  GATE9C3E_QA_JOURNAL_NAME,
  publishQaPreviousOwnerJournal,
  readQaPreviousOwnerJournal,
  type QaOwnerJournalRecord
} from './managed-previous-owner-journal-qa'
import { buildQaSupervisedReviewPacket } from './managed-qa-supervised-review-packet'

// C4-B2-B: only current QA test Node process, owned loopback TCP listener,
// private native mutex and disposable TEMP journal. NO old host/motor PID.
const windowsOnly = process.platform === 'win32' ? describe : describe.skip
let root = ''
let previousJournalFlag: string | undefined
let previousNativeFlag: string | undefined
const ownedLeases: ManagedMotorLeaseHandle[] = []
const ownedServers: Server[] = []

function native() {
  const load = loadWindowsSecurity()
  if ('error' in load) throw new Error('GATE9C4B2B_NATIVE_NOT_AVAILABLE')
  return load.addon
}

function takeLease(): { lease: ManagedMotorLeaseHandle; hash: string } {
  const hash = createHash('sha256').update(randomUUID()).digest('hex')
  const result = native().acquireManagedMotorLease(hash)
  if (result.state !== 'ACQUIRED_REQUIRES_RECONCILIATION') {
    throw new Error('GATE9C4B2B_SYNTHETIC_LEASE_BUSY')
  }
  ownedLeases.push(result.lease)
  return { lease: result.lease, hash }
}

async function ownLocalListener(): Promise<Server> {
  const server = createServer((socket) => socket.destroy())
  ownedServers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return server
}

async function closeLocalListener(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()))
}

function initialRecord(): QaOwnerJournalRecord {
  return {
    version: 1,
    kind: 'ORCA_GATE9C3E_SYNTHETIC_QA_ONLY',
    motorIdentitySha256: 'c'.repeat(64),
    generationId: randomUUID(),
    owner: { pid: process.pid, creationTimeTicks: '133776550123456789' },
    phase: 'PREPARING',
    revision: 1,
    previousDigest: null,
    jobRoot: null,
    observedActiveProcesses: null,
    recordedAt: '2026-11-04T12:00:00.000Z'
  }
}

function persistCleanStop(): void {
  const first = initialRecord()
  publishQaPreviousOwnerJournal(root, first)
  const one = readQaPreviousOwnerJournal(root)
  if (one.state !== 'QA_RECORD_UNATTESTED') throw new Error('C4B2B_FIRST_READ_FAILED')
  const second: QaOwnerJournalRecord = {
    ...first,
    phase: 'JOB_ASSIGNED',
    revision: 2,
    previousDigest: one.digestSha256,
    jobRoot: { pid: 123456, creationTimeTicks: '133776550123456788' },
    observedActiveProcesses: 1
  }
  publishQaPreviousOwnerJournal(root, second)
  const two = readQaPreviousOwnerJournal(root)
  if (two.state !== 'QA_RECORD_UNATTESTED') throw new Error('C4B2B_SECOND_READ_FAILED')
  publishQaPreviousOwnerJournal(root, {
    ...second,
    phase: 'CLEAN_STOP',
    revision: 3,
    previousDigest: two.digestSha256,
    observedActiveProcesses: 0
  })
}

windowsOnly('Gate 9B-C4-B2-B owned native snapshot plus historical QA quarantine', () => {
  beforeEach(() => {
    previousJournalFlag = process.env.ORCA_GATE9C3E_TEST_ONLY
    previousNativeFlag = process.env.ORCA_GATE9C4B2_TEST_ONLY
    process.env.ORCA_GATE9C3E_TEST_ONLY = '1'
    process.env.ORCA_GATE9C4B2_TEST_ONLY = '1'
    root = mkdtempSync(join(tmpdir(), 'orca-gate9c3e-owner-'))
  })

  afterEach(async () => {
    for (const server of ownedServers.splice(0)) await closeLocalListener(server)
    for (const lease of ownedLeases.splice(0)) lease.close()
    if (previousJournalFlag === undefined) delete process.env.ORCA_GATE9C3E_TEST_ONLY
    else process.env.ORCA_GATE9C3E_TEST_ONLY = previousJournalFlag
    if (previousNativeFlag === undefined) delete process.env.ORCA_GATE9C4B2_TEST_ONLY
    else process.env.ORCA_GATE9C4B2_TEST_ONLY = previousNativeFlag
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('separates a real current QA process observation from MISSING historical owner', async () => {
    const { lease, hash } = takeLease()
    const server = await ownLocalListener()
    const packet = buildQaSupervisedReviewPacket(lease, hash, randomUUID(), server, root)
    expect(packet).toMatchObject({
      state: 'BLOCKED',
      startupAllowed: false,
      diagnosticsOnly: true,
      supervisorReviewRequired: true,
      currentInstance: { state: 'CURRENT_QA_PROCESS_ONLY', pid: process.pid },
      previousOwner: { state: 'UNVERIFIED', reason: 'HISTORICAL_JOURNAL_MISSING' }
    })
    expect(packet.missingEvidence).toContain('PREVIOUS_JOB_OBJECT_DESCENDANTS_NOT_CENSUSED')
    expect(packet.currentInstance.creationTimeTicks).toMatch(/^[1-9][0-9]{11,19}$/)
  })

  it('preserves interrupted PREPARING journal as unverified while own native sensor succeeds', async () => {
    publishQaPreviousOwnerJournal(root, initialRecord())
    const { lease, hash } = takeLease()
    const server = await ownLocalListener()
    const packet = buildQaSupervisedReviewPacket(lease, hash, randomUUID(), server, root)
    expect(packet.previousOwner).toEqual({
      state: 'UNVERIFIED', reason: 'PREVIOUS_OWNER_INTERRUPTED_OR_UNVERIFIED'
    })
    expect(packet.currentInstance.state).toBe('CURRENT_QA_PROCESS_ONLY')
    expect(packet.startupAllowed).toBe(false)
  })

  it('does not promote a syntactically valid historical CLEAN_STOP when current native sensor succeeds', async () => {
    persistCleanStop()
    const { lease, hash } = takeLease()
    const server = await ownLocalListener()
    const packet = buildQaSupervisedReviewPacket(lease, hash, randomUUID(), server, root)
    expect(packet.previousOwner.reason).toBe('CLEAN_STOP_HISTORY_UNATTESTED')
    expect(packet.state).toBe('BLOCKED')
    expect(packet.missingEvidence).toContain('PREVIOUS_OWNER_AUTHENTICITY_NOT_ESTABLISHED')
  })

  it('blocks a truncated journal even while the current process remains healthy', async () => {
    persistCleanStop()
    writeFileSync(join(root, GATE9C3E_QA_JOURNAL_NAME), '{')
    const { lease, hash } = takeLease()
    const server = await ownLocalListener()
    const packet = buildQaSupervisedReviewPacket(lease, hash, randomUUID(), server, root)
    expect(packet.previousOwner.reason).toBe('HISTORICAL_JOURNAL_UNVERIFIABLE')
    expect(packet.state).toBe('BLOCKED')
  })

  it('does not equate a fake native lease prototype with a process observation', async () => {
    const { lease, hash } = takeLease()
    const server = await ownLocalListener()
    const fake = Object.create(Object.getPrototypeOf(lease)) as ManagedMotorLeaseHandle
    const packet = buildQaSupervisedReviewPacket(fake, hash, randomUUID(), server, root)
    expect(packet.currentInstance).toMatchObject({
      state: 'UNKNOWN', pid: null, creationTimeTicks: null,
      reason: 'NATIVE_LEASE_NOT_VERIFIED'
    })
    expect(packet.missingEvidence).toContain('CURRENT_QA_OBSERVATION_UNKNOWN')
    expect(packet.startupAllowed).toBe(false)
  })

  it('rejects native observation when opt-in is absent without upgrading historical trust', async () => {
    const { lease, hash } = takeLease()
    const server = await ownLocalListener()
    delete process.env.ORCA_GATE9C4B2_TEST_ONLY
    const packet = buildQaSupervisedReviewPacket(lease, hash, randomUUID(), server, root)
    expect(packet.currentInstance.reason).toBe('QA_ENVIRONMENT_NOT_ALLOWED')
    expect(packet.previousOwner.state).toBe('UNVERIFIED')
    expect(packet.state).toBe('BLOCKED')
  })

  it('rejects an arbitrary historical root instead of treating its absence as proven', async () => {
    const { lease, hash } = takeLease()
    const server = await ownLocalListener()
    const packet = buildQaSupervisedReviewPacket(
      lease, hash, randomUUID(), server, 'C:\\Not-A-QA-Root'
    )
    expect(packet.previousOwner).toEqual({
      state: 'UNVERIFIED', reason: 'JOURNAL_READER_REJECTED'
    })
    expect(packet.startupAllowed).toBe(false)
  })

  it('never leaks native executable paths, journal paths, lease hashes or any launch capability', async () => {
    persistCleanStop()
    const { lease, hash } = takeLease()
    const server = await ownLocalListener()
    const packet = buildQaSupervisedReviewPacket(lease, hash, randomUUID(), server, root)
    const result = JSON.stringify(packet)
    expect(result).not.toContain(process.execPath)
    expect(result).not.toContain(root)
    expect(result).not.toContain(hash)
    expect(result).not.toContain('executablePath')
    expect(result).not.toContain('READY_FOR_')
    expect(result).not.toContain('NO_OLD_OWNER')
    expect(packet.missingEvidence).toEqual([
      'PREVIOUS_OWNER_AUTHENTICITY_NOT_ESTABLISHED',
      'PREVIOUS_JOB_OBJECT_DESCENDANTS_NOT_CENSUSED',
      'PREVIOUS_OWNER_JOURNAL_NOT_TRUSTED'
    ])
  })
})
