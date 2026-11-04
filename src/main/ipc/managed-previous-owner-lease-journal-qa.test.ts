import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadWindowsSecurity } from '../../shared/windows-security-addon'
import {
  publishQaPreviousOwnerJournalWithNativeLease
} from './managed-previous-owner-lease-journal-qa'
import {
  readQaPreviousOwnerJournal,
  type QaOwnerJournalRecord
} from './managed-previous-owner-journal-qa'
import type { ManagedMotorLeaseHandle } from '../../../native/windows-security'

// C3-E-B: native mutex ownership and a disposable Windows QA file only.
// No motor, Python, WCB, operational port, host process inspection or kill.
const windowsOnly = process.platform === 'win32' ? describe : describe.skip
let root = ''
let oldOptIn: string | undefined
const held: ManagedMotorLeaseHandle[] = []

function native() {
  const loaded = loadWindowsSecurity()
  if ('error' in loaded) throw new Error('GATE9C3EB_ADDON_LOAD_FAILED')
  expect(loaded.addon.hasNativeExport('verifyManagedMotorLeaseOwnerForQa')).toBe(true)
  return loaded.addon
}

function identity(): string {
  return createHash('sha256').update(randomUUID()).digest('hex')
}

function acquire(hash: string): ManagedMotorLeaseHandle {
  const result = native().acquireManagedMotorLease(hash)
  if (result.state !== 'ACQUIRED_REQUIRES_RECONCILIATION') {
    throw new Error('GATE9C3EB_EXPECTED_SYNTHETIC_LEASE')
  }
  held.push(result.lease)
  return result.lease
}

function recordFor(lease: ManagedMotorLeaseHandle, digest: string): QaOwnerJournalRecord {
  const proof = native().verifyManagedMotorLeaseOwnerForQa(lease, digest)
  if (!proof.verified) throw new Error('GATE9C3EB_NATIVE_PROOF_EXPECTED')
  return {
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

windowsOnly('Gate 9B-C3-E-B native lease-fenced QA journal', () => {
  beforeEach(() => {
    oldOptIn = process.env.ORCA_GATE9C3E_TEST_ONLY
    process.env.ORCA_GATE9C3E_TEST_ONLY = '1'
    root = mkdtempSync(join(tmpdir(), 'orca-gate9c3e-owner-'))
  })

  afterEach(() => {
    for (const lease of held.splice(0)) lease.close()
    if (oldOptIn === undefined) delete process.env.ORCA_GATE9C3E_TEST_ONLY
    else process.env.ORCA_GATE9C3E_TEST_ONLY = oldOptIn
    if (root) rmSync(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 })
  })

  it('writes an UNATTESTED QA journal only with a real native mutex owner', () => {
    const digest = identity()
    const lease = acquire(digest)
    const record = recordFor(lease, digest)
    expect(publishQaPreviousOwnerJournalWithNativeLease(root, record, lease)).toEqual({
      state: 'QA_PERSISTED_UNATTESTED',
      revision: 1,
      ownerLeaseChecked: true
    })
    expect(readQaPreviousOwnerJournal(root)).toMatchObject({
      state: 'QA_RECORD_UNATTESTED',
      record: { motorIdentitySha256: digest, owner: record.owner }
    })
    expect(native().verifyManagedMotorLeaseOwnerForQa(lease, digest).verified).toBe(true)
  })

  it('refuses a plain JS object spoofing a native lease and writes nothing', () => {
    const digest = identity()
    const lease = acquire(digest)
    const record = recordFor(lease, digest)
    const forged = {
      snapshot: () => ({ held: true, motorIdentitySha256: digest }),
      close: () => undefined
    } as unknown as ManagedMotorLeaseHandle
    expect(native().verifyManagedMotorLeaseOwnerForQa(forged, digest).verified).toBe(false)
    // Copying the prototype of a valid ObjectWrap must also fail; a JS
    // prototype chain is not proof of the native type tag or live HANDLE.
    const prototypeForged = Object.create(Object.getPrototypeOf(lease)) as
      ManagedMotorLeaseHandle
    expect(native().verifyManagedMotorLeaseOwnerForQa(prototypeForged, digest).verified)
      .toBe(false)
    expect(() => publishQaPreviousOwnerJournalWithNativeLease(root, record, forged))
      .toThrow('GATE9C3EB_NATIVE_LEASE_NOT_OWNED')
    expect(readQaPreviousOwnerJournal(root).state).toBe('MISSING')
  })

  it('refuses an already closed native lease without writing', () => {
    const digest = identity()
    const lease = acquire(digest)
    const record = recordFor(lease, digest)
    lease.close()
    expect(native().verifyManagedMotorLeaseOwnerForQa(lease, digest).verified).toBe(false)
    expect(() => publishQaPreviousOwnerJournalWithNativeLease(root, record, lease))
      .toThrow('GATE9C3EB_NATIVE_LEASE_NOT_OWNED')
    expect(readQaPreviousOwnerJournal(root).state).toBe('MISSING')
  })

  it('blocks another motor identity and a competing lease for the same identity', () => {
    const digest = identity()
    const lease = acquire(digest)
    const record = recordFor(lease, digest)
    const different = acquire(identity())
    expect(native().acquireManagedMotorLease(digest).state).toBe('HELD_BY_OTHER')
    expect(native().verifyManagedMotorLeaseOwnerForQa(different, digest).verified).toBe(false)
    expect(() => publishQaPreviousOwnerJournalWithNativeLease(root, record, different))
      .toThrow('GATE9C3EB_NATIVE_LEASE_NOT_OWNED')
    expect(readQaPreviousOwnerJournal(root).state).toBe('MISSING')
  })

  it('rejects a forged PID or creation-time record even with the real native lease', () => {
    const digest = identity()
    const lease = acquire(digest)
    const record = recordFor(lease, digest)
    for (const owner of [
      { ...record.owner, pid: record.owner.pid + 1 },
      { ...record.owner, creationTimeTicks:
        (BigInt(record.owner.creationTimeTicks) + 1n).toString() }
    ]) {
      expect(() => publishQaPreviousOwnerJournalWithNativeLease(root, {
        ...record, owner
      }, lease)).toThrow('GATE9C3EB_OWNER_IDENTITY_MISMATCH')
    }
    expect(readQaPreviousOwnerJournal(root).state).toBe('MISSING')
  })

  it('does not overwrite an interrupted journal using a fresh owner generation', () => {
    const digest = identity()
    const original = acquire(digest)
    const record = recordFor(original, digest)
    publishQaPreviousOwnerJournalWithNativeLease(root, record, original)
    original.close()

    // New acquisition is provisional, never proof that all old job
    // descendants disappeared. The existing PREPARING journal cannot be
    // rewritten as a clean new first generation.
    const next = acquire(digest)
    const freshGeneration: QaOwnerJournalRecord = {
      ...recordFor(next, digest),
      generationId: randomUUID()
    }
    expect(() => publishQaPreviousOwnerJournalWithNativeLease(root, freshGeneration, next))
      .toThrow('GATE9C3E_PREVIOUS_OWNER_MISMATCH')
    expect(readQaPreviousOwnerJournal(root)).toMatchObject({
      state: 'QA_RECORD_UNATTESTED',
      record: { generationId: record.generationId, phase: 'PREPARING' }
    })
  })
})
