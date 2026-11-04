import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  GATE9C3E_QA_JOURNAL_NAME,
  publishQaPreviousOwnerJournal,
  readQaPreviousOwnerJournal,
  type QaOwnerJournalRecord
} from './managed-previous-owner-journal-qa'
import {
  quarantineQaHistoricalJournal
} from './managed-qa-historical-recovery-quarantine'

// QA-only adversarial file inputs inside a fresh, disposable Windows TEMP
// root. No operational motor, IPC, Job Object, WCB, process manipulation.
const windowsOnly = process.platform === 'win32' ? describe : describe.skip
let root = ''
let oldOptIn: string | undefined

type Envelope = {
  payload: QaOwnerJournalRecord
  digestSha256: string
}

function preparing(): QaOwnerJournalRecord {
  return {
    version: 1,
    kind: 'ORCA_GATE9C3E_SYNTHETIC_QA_ONLY',
    motorIdentitySha256: 'a'.repeat(64),
    generationId: 'd0a0ca01-2345-489a-9012-abcdef123456',
    owner: { pid: process.pid, creationTimeTicks: '133776550123456789' },
    phase: 'PREPARING',
    revision: 1,
    previousDigest: null,
    jobRoot: null,
    observedActiveProcesses: null,
    recordedAt: '2026-11-04T12:00:00.000Z'
  }
}

function file(): string {
  return join(root, GATE9C3E_QA_JOURNAL_NAME)
}

function save(record: QaOwnerJournalRecord): void {
  publishQaPreviousOwnerJournal(root, record)
}

function readEnvelope(): Envelope {
  return JSON.parse(readFileSync(file(), 'utf8')) as Envelope
}

function rewriteEnvelope(envelope: Envelope): void {
  writeFileSync(file(), JSON.stringify(envelope))
}

function digest(record: QaOwnerJournalRecord): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex')
}

function assigned(): QaOwnerJournalRecord {
  save(preparing())
  const first = readQaPreviousOwnerJournal(root)
  if (first.state !== 'QA_RECORD_UNATTESTED') {
    throw new Error('GATE9C3EE_PREPARE_NOT_PERSISTED')
  }
  const record: QaOwnerJournalRecord = {
    ...preparing(),
    phase: 'JOB_ASSIGNED',
    revision: 2,
    previousDigest: first.digestSha256,
    jobRoot: { pid: 90001, creationTimeTicks: '133776550123456790' },
    observedActiveProcesses: 1
  }
  save(record)
  return record
}

function cleanStop(): void {
  const earlier = assigned()
  const read = readQaPreviousOwnerJournal(root)
  if (read.state !== 'QA_RECORD_UNATTESTED') {
    throw new Error('GATE9C3EE_ASSIGNED_NOT_PERSISTED')
  }
  save({
    ...earlier,
    phase: 'CLEAN_STOP',
    revision: 3,
    previousDigest: read.digestSha256,
    observedActiveProcesses: 0
  })
}

windowsOnly('Gate 9B-C3-E-E hostile historical journal must never authorize restart', () => {
  beforeEach(() => {
    oldOptIn = process.env.ORCA_GATE9C3E_TEST_ONLY
    process.env.ORCA_GATE9C3E_TEST_ONLY = '1'
    root = mkdtempSync(join(tmpdir(), 'orca-gate9c3e-owner-'))
  })

  afterEach(() => {
    if (oldOptIn === undefined) delete process.env.ORCA_GATE9C3E_TEST_ONLY
    else process.env.ORCA_GATE9C3E_TEST_ONLY = oldOptIn
    if (root) rmSync(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 })
  })

  it('blocks when historical journal is missing, not treated as a fresh empty root', () => {
    expect(quarantineQaHistoricalJournal(root)).toEqual({
      state: 'BLOCKED',
      reason: 'HISTORICAL_JOURNAL_MISSING',
      journalIntegrity: 'UNVERIFIED',
      startupAllowed: false
    })
  })

  it('blocks a previous PREPARING owner after simulated abrupt interruption', () => {
    save(preparing())
    expect(quarantineQaHistoricalJournal(root)).toMatchObject({
      state: 'BLOCKED',
      reason: 'PREVIOUS_OWNER_INTERRUPTED_OR_UNVERIFIED',
      startupAllowed: false
    })
  })

  it('blocks a previous JOB_ASSIGNED owner even if the root PID no longer exists', () => {
    assigned()
    expect(quarantineQaHistoricalJournal(root)).toMatchObject({
      state: 'BLOCKED',
      reason: 'PREVIOUS_OWNER_INTERRUPTED_OR_UNVERIFIED',
      startupAllowed: false
    })
  })

  it('blocks even an intact, syntactically valid historical CLEAN_STOP record', () => {
    cleanStop()
    expect(readQaPreviousOwnerJournal(root).state).toBe('QA_RECORD_UNATTESTED')
    expect(quarantineQaHistoricalJournal(root)).toEqual({
      state: 'BLOCKED',
      reason: 'CLEAN_STOP_HISTORY_UNATTESTED',
      journalIntegrity: 'UNVERIFIED',
      startupAllowed: false
    })
  })

  it('blocks JSON truncation and never calls it a missing clean state', () => {
    cleanStop()
    writeFileSync(file(), '{"payload":')
    expect(quarantineQaHistoricalJournal(root)).toMatchObject({
      state: 'BLOCKED',
      reason: 'HISTORICAL_JOURNAL_UNVERIFIABLE',
      startupAllowed: false
    })
  })

  it('rejects an edit that does not update its checksum', () => {
    cleanStop()
    const envelope = readEnvelope()
    envelope.payload.owner.pid += 1
    rewriteEnvelope(envelope)
    expect(quarantineQaHistoricalJournal(root)).toMatchObject({
      state: 'BLOCKED', reason: 'HISTORICAL_JOURNAL_UNVERIFIABLE'
    })
  })

  it('cannot promote a same-user forged CLEAN_STOP with a recalculated valid SHA-256', () => {
    // IMPORTANT: anyone who can edit the JSON can recompute its digest.
    // This must demonstrate that a VALID digest is not proof of authorship.
    cleanStop()
    const envelope = readEnvelope()
    envelope.payload.owner.pid += 7
    envelope.payload.motorIdentitySha256 = 'b'.repeat(64)
    envelope.digestSha256 = digest(envelope.payload)
    rewriteEnvelope(envelope)
    expect(readQaPreviousOwnerJournal(root)).toMatchObject({
      state: 'QA_RECORD_UNATTESTED',
      record: { owner: { pid: process.pid + 7 } }
    })
    expect(quarantineQaHistoricalJournal(root)).toEqual({
      state: 'BLOCKED',
      reason: 'CLEAN_STOP_HISTORY_UNATTESTED',
      journalIntegrity: 'UNVERIFIED',
      startupAllowed: false
    })
  })

  it('blocks a byte-for-byte rollback to an older valid generation revision', () => {
    save(preparing())
    const oldBytes = readFileSync(file())
    const first = readQaPreviousOwnerJournal(root)
    if (first.state !== 'QA_RECORD_UNATTESTED') {
      throw new Error('GATE9C3EE_NO_FIRST_CHECKPOINT')
    }
    const second: QaOwnerJournalRecord = {
      ...preparing(),
      phase: 'JOB_ASSIGNED',
      revision: 2,
      previousDigest: first.digestSha256,
      jobRoot: { pid: 90001, creationTimeTicks: '133776550123456790' },
      observedActiveProcesses: 1
    }
    save(second)
    const assignedRead = readQaPreviousOwnerJournal(root)
    if (assignedRead.state !== 'QA_RECORD_UNATTESTED') {
      throw new Error('GATE9C3EE_NO_SECOND_CHECKPOINT')
    }
    save({
      ...second, phase: 'CLEAN_STOP', revision: 3,
      observedActiveProcesses: 0,
      previousDigest: assignedRead.digestSha256
    })
    // An offline attacker can replay a previously valid file with its digest.
    writeFileSync(file(), oldBytes)
    expect(readQaPreviousOwnerJournal(root)).toMatchObject({
      state: 'QA_RECORD_UNATTESTED', record: { phase: 'PREPARING', revision: 1 }
    })
    expect(quarantineQaHistoricalJournal(root)).toMatchObject({
      state: 'BLOCKED', reason: 'PREVIOUS_OWNER_INTERRUPTED_OR_UNVERIFIED'
    })
  })

  it('blocks a user-supplied ATTESTED flag even if digest is updated', () => {
    cleanStop()
    const envelope = readEnvelope() as Envelope & {
      payload: QaOwnerJournalRecord & { journalIntegrity?: string }
    }
    envelope.payload.journalIntegrity = 'ATTESTED'
    envelope.digestSha256 = digest(envelope.payload)
    rewriteEnvelope(envelope)
    expect(quarantineQaHistoricalJournal(root)).toMatchObject({
      state: 'BLOCKED', reason: 'HISTORICAL_JOURNAL_UNVERIFIABLE'
    })
  })
})
