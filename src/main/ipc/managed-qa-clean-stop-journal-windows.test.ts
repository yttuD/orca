import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadWindowsSecurity } from '../../shared/windows-security-addon'
import {
  closeOwnedQaJobAndPersistUnattestedStop
} from './managed-qa-clean-stop-journal'
import {
  publishQaPreviousOwnerJournalWithNativeLease
} from './managed-previous-owner-lease-journal-qa'
import {
  readQaPreviousOwnerJournal,
  type QaOwnerJournalRecord
} from './managed-previous-owner-journal-qa'
import type {
  ManagedJobContainedProcess,
  ManagedMotorLeaseHandle
} from '../../../native/windows-security'

// Isolated C3-E-D QA. Only synthetic Node children and private Job Objects
// created here; no external process/PID operations, TCP, WCB or FastAPI.
const windowsOnly = process.platform === 'win32' ? describe : describe.skip
let root = ''
let oldOptIn: string | undefined
const jobs: ManagedJobContainedProcess[] = []
const leases: ManagedMotorLeaseHandle[] = []

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitUntil(predicate: () => boolean, ms = 12000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('GATE9C3ED_SYNTHETIC_JOB_TIMEOUT')
    await sleep(75)
  }
}

function addon() {
  const loaded = loadWindowsSecurity()
  if ('error' in loaded) throw new Error('GATE9C3ED_NATIVE_ADDON_UNAVAILABLE')
  expect(loaded.addon.hasNativeExport('closeRecordedManagedJobIfEmptyForQa')).toBe(true)
  return loaded.addon
}

function startLease(): { lease: ManagedMotorLeaseHandle; record: QaOwnerJournalRecord } {
  const digest = createHash('sha256').update(randomUUID()).digest('hex')
  const acquired = addon().acquireManagedMotorLease(digest)
  if (acquired.state !== 'ACQUIRED_REQUIRES_RECONCILIATION') {
    throw new Error('GATE9C3ED_SYNTHETIC_LEASE_BUSY')
  }
  leases.push(acquired.lease)
  const proof = addon().verifyManagedMotorLeaseOwnerForQa(acquired.lease, digest)
  if (!proof.verified) throw new Error('GATE9C3ED_OWNER_PROOF_NOT_AVAILABLE')
  return {
    lease: acquired.lease,
    record: {
      version: 1,
      kind: 'ORCA_GATE9C3E_SYNTHETIC_QA_ONLY',
      motorIdentitySha256: digest,
      generationId: randomUUID(),
      owner: {
        pid: proof.ownerPid,
        creationTimeTicks: proof.ownerCreationTimeTicks
      },
      phase: 'PREPARING',
      revision: 1,
      previousDigest: null,
      jobRoot: null,
      observedActiveProcesses: null,
      recordedAt: new Date().toISOString()
    }
  }
}

function envBlock(): string {
  const names = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'Path', 'PATHEXT']
  return names.flatMap((name) => {
    const val = process.env[name]
    return val ? [name + '=' + val] : []
  }).join('\0') + '\0\0'
}

function quote(value: string): string {
  if (value.includes('"') || value.includes('\0')) {
    throw new Error('GATE9C3ED_UNSAFE_QA_SCRIPT')
  }
  return '"' + value + '"'
}

function createSyntheticJob(script: string): ManagedJobContainedProcess {
  const file = path.join(root, 'qa-e-d-root.cjs')
  writeFileSync(file, script, { flag: 'wx' })
  const job = addon().spawnManagedJobContained(
    process.execPath,
    quote(process.execPath) + ' ' + quote(file),
    root,
    envBlock()
  )
  jobs.push(job)
  return job
}

function prepareJournal(lease: ManagedMotorLeaseHandle, record: QaOwnerJournalRecord): void {
  publishQaPreviousOwnerJournalWithNativeLease(root, record, lease)
}

function assignJournal(
  lease: ManagedMotorLeaseHandle,
  record: QaOwnerJournalRecord,
  job: ManagedJobContainedProcess,
  alterIdentity: boolean = false
): void {
  const initial = readQaPreviousOwnerJournal(root)
  if (initial.state !== 'QA_RECORD_UNATTESTED') {
    throw new Error('GATE9C3ED_INITIAL_RECORD_NOT_PERSISTED')
  }
  const snap = job.snapshot()
  publishQaPreviousOwnerJournalWithNativeLease(root, {
    ...record,
    phase: 'JOB_ASSIGNED',
    revision: 2,
    previousDigest: initial.digestSha256,
    jobRoot: {
      pid: snap.pid + (alterIdentity ? 1 : 0),
      creationTimeTicks: snap.creationTimeTicks
    },
    observedActiveProcesses: snap.activeProcesses,
    recordedAt: new Date().toISOString()
  }, lease)
}

windowsOnly('Gate 9B-C3-E-D native job identity -> held lease -> QA journal', () => {
  beforeEach(() => {
    oldOptIn = process.env.ORCA_GATE9C3E_TEST_ONLY
    process.env.ORCA_GATE9C3E_TEST_ONLY = '1'
    root = mkdtempSync(path.join(tmpdir(), 'orca-gate9c3e-owner-'))
  })

  afterEach(async () => {
    // Only these exact synthetic native job objects, never arbitrary PIDs.
    for (const job of jobs.splice(0)) job.close()
    for (const lease of leases.splice(0)) lease.close()
    if (oldOptIn === undefined) delete process.env.ORCA_GATE9C3E_TEST_ONLY
    else process.env.ORCA_GATE9C3E_TEST_ONLY = oldOptIn
    if (root) {
      await waitUntil(() => {
        try {
          rmSync(root, { recursive: true, force: true })
          return true
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY') return false
          throw error
        }
      }, 8000)
    }
  })

  it('persists UNATTESTED CLEAN_STOP only after native Job Object is actually empty', async () => {
    const { lease, record } = startLease()
    prepareJournal(lease, record)
    const job = createSyntheticJob('process.exit(0)')
    assignJournal(lease, record, job)
    await waitUntil(() => {
      const snap = job.snapshot()
      return !snap.rootRunning && snap.activeProcesses === 0
    })
    expect(closeOwnedQaJobAndPersistUnattestedStop(root, lease, job)).toEqual({
      state: 'QA_CLEAN_STOP_PERSISTED_UNATTESTED',
      revision: 3,
      nativeCloseState: 'CLOSED_EMPTY_QA_ONLY'
    })
    expect(readQaPreviousOwnerJournal(root)).toMatchObject({
      state: 'QA_RECORD_UNATTESTED',
      record: { phase: 'CLEAN_STOP', revision: 3, observedActiveProcesses: 0 }
    })
    expect(job.snapshot().closed).toBe(true)
    // The historical record cannot be replayed to claim a new native close.
    expect(closeOwnedQaJobAndPersistUnattestedStop(root, lease, job)).toEqual({
      state: 'BLOCKED', reason: 'JOURNAL_NOT_JOB_ASSIGNED'
    })
  }, 20000)

  it('blocks CLEAN_STOP while the own synthetic Job Object root is alive', async () => {
    const { lease, record } = startLease()
    prepareJournal(lease, record)
    const job = createSyntheticJob('setInterval(() => {}, 1000)')
    assignJournal(lease, record, job)
    await waitUntil(() => job.snapshot().rootRunning)
    expect(closeOwnedQaJobAndPersistUnattestedStop(root, lease, job)).toEqual({
      state: 'BLOCKED',
      reason: 'NATIVE_JOB_CLEAN_CLOSE_REFUSED',
      nativeCloseState: 'ROOT_STILL_RUNNING'
    })
    expect(job.snapshot().closed).toBe(false)
    expect(readQaPreviousOwnerJournal(root)).toMatchObject({
      state: 'QA_RECORD_UNATTESTED',
      record: { phase: 'JOB_ASSIGNED', revision: 2 }
    })
  }, 20000)

  it('blocks a JS object that fabricates a clean-close witness', () => {
    const { lease, record } = startLease()
    prepareJournal(lease, record)
    const job = createSyntheticJob('setInterval(() => {}, 1000)')
    assignJournal(lease, record, job)
    const fake = {
      snapshot: () => job.snapshot(),
      closeIfEmptyForQa: () => ({
        state: 'CLOSED_EMPTY_QA_ONLY',
        pid: job.snapshot().pid,
        creationTimeTicks: job.snapshot().creationTimeTicks,
        observedActiveProcesses: 0,
        rootExitedBeforeClose: true,
        notHistoricalAttestation: true
      }),
      close: () => undefined
    } as unknown as ManagedJobContainedProcess
    expect(closeOwnedQaJobAndPersistUnattestedStop(root, lease, fake)).toEqual({
      state: 'BLOCKED',
      reason: 'NATIVE_JOB_CLEAN_CLOSE_REFUSED',
      nativeCloseState: 'UNTRUSTED_JOB_OBJECT'
    })
    expect(job.snapshot().closed).toBe(false)
    expect(readQaPreviousOwnerJournal(root)).toMatchObject({
      state: 'QA_RECORD_UNATTESTED',
      record: { phase: 'JOB_ASSIGNED' }
    })
  }, 20000)

  it('rejects a wrong journal Job Object root identity', () => {
    const { lease, record } = startLease()
    prepareJournal(lease, record)
    const job = createSyntheticJob('setInterval(() => {}, 1000)')
    assignJournal(lease, record, job, true)
    expect(closeOwnedQaJobAndPersistUnattestedStop(root, lease, job)).toEqual({
      state: 'BLOCKED',
      reason: 'NATIVE_JOB_CLEAN_CLOSE_REFUSED',
      nativeCloseState: 'JOB_IDENTITY_MISMATCH'
    })
    expect(job.snapshot().closed).toBe(false)
  }, 20000)

  it('refuses to attempt native close after owner lease is released', () => {
    const { lease, record } = startLease()
    prepareJournal(lease, record)
    const job = createSyntheticJob('setInterval(() => {}, 1000)')
    assignJournal(lease, record, job)
    lease.close()
    expect(closeOwnedQaJobAndPersistUnattestedStop(root, lease, job)).toEqual({
      state: 'BLOCKED', reason: 'NATIVE_LEASE_MISMATCH'
    })
    expect(job.snapshot().closed).toBe(false)
    expect(readQaPreviousOwnerJournal(root)).toMatchObject({
      state: 'QA_RECORD_UNATTESTED', record: { phase: 'JOB_ASSIGNED' }
    })
  }, 20000)

  it('rejects any clean-stop attempt before a JOB_ASSIGNED journal record exists', () => {
    const { lease, record } = startLease()
    prepareJournal(lease, record)
    const job = createSyntheticJob('setInterval(() => {}, 1000)')
    expect(closeOwnedQaJobAndPersistUnattestedStop(root, lease, job)).toEqual({
      state: 'BLOCKED', reason: 'JOURNAL_NOT_JOB_ASSIGNED'
    })
    expect(job.snapshot().closed).toBe(false)
    expect(readQaPreviousOwnerJournal(root)).toMatchObject({
      state: 'QA_RECORD_UNATTESTED', record: { phase: 'PREPARING' }
    })
  }, 20000)
})
