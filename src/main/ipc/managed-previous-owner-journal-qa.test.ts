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

// Windows-only, isolated TEMP records. No motor, bridge, operational port or
// process involved. All records are explicitly UNATTESTED synthetic telemetry.
const windowsOnly = process.platform === 'win32' ? describe : describe.skip
let root: string
let priorOptIn: string | undefined

const preparing = (): QaOwnerJournalRecord => ({
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
})

const withAssignedJob = (earlierDigest: string): QaOwnerJournalRecord => ({
  ...preparing(),
  phase: 'JOB_ASSIGNED',
  revision: 2,
  previousDigest: earlierDigest,
  jobRoot: { pid: 90001, creationTimeTicks: '133776550123456790' },
  observedActiveProcesses: 1
})

windowsOnly('Gate 9B-C3-E-A isolated durable QA owner journal', () => {
  beforeEach(() => {
    priorOptIn = process.env.ORCA_GATE9C3E_TEST_ONLY
    process.env.ORCA_GATE9C3E_TEST_ONLY = '1'
    root = mkdtempSync(join(tmpdir(), 'orca-gate9c3e-owner-'))
  })

  afterEach(() => {
    if (priorOptIn === undefined) delete process.env.ORCA_GATE9C3E_TEST_ONLY
    else process.env.ORCA_GATE9C3E_TEST_ONLY = priorOptIn
    rmSync(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 })
  })

  it('returns missing but never a trusted clean state for a new QA root', () => {
    expect(readQaPreviousOwnerJournal(root)).toEqual({ state: 'MISSING' })
  })

  it('persists an initial record durably and reads it only as UNATTESTED telemetry', () => {
    const record = preparing()
    expect(publishQaPreviousOwnerJournal(root, record)).toEqual({
      state: 'QA_PERSISTED_UNATTESTED', revision: 1
    })
    expect(readQaPreviousOwnerJournal(root)).toEqual({
      state: 'QA_RECORD_UNATTESTED',
      record,
      digestSha256: expect.stringMatching(/^[0-9a-f]{64}$/)
    })
    const parsed = JSON.parse(readFileSync(
      join(root, GATE9C3E_QA_JOURNAL_NAME), 'utf8'
    )) as { digestSha256: string }
    expect(parsed.digestSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('permits only chained PREPARING -> JOB_ASSIGNED -> CLEAN_STOP QA writes', () => {
    publishQaPreviousOwnerJournal(root, preparing())
    const initial = readQaPreviousOwnerJournal(root)
    expect(initial.state).toBe('QA_RECORD_UNATTESTED')
    if (initial.state !== 'QA_RECORD_UNATTESTED') return

    const second = withAssignedJob(initial.digestSha256)
    publishQaPreviousOwnerJournal(root, second)
    const assigned = readQaPreviousOwnerJournal(root)
    expect(assigned.state).toBe('QA_RECORD_UNATTESTED')
    if (assigned.state !== 'QA_RECORD_UNATTESTED') return

    const final: QaOwnerJournalRecord = {
      ...second, phase: 'CLEAN_STOP', revision: 3,
      previousDigest: assigned.digestSha256, observedActiveProcesses: 0
    }
    expect(publishQaPreviousOwnerJournal(root, final)).toEqual({
      state: 'QA_PERSISTED_UNATTESTED', revision: 3
    })
    expect(readQaPreviousOwnerJournal(root)).toMatchObject({
      state: 'QA_RECORD_UNATTESTED',
      record: { phase: 'CLEAN_STOP', revision: 3 }
    })
    expect(() => publishQaPreviousOwnerJournal(root, {
      ...final, revision: 4,
      previousDigest: (readQaPreviousOwnerJournal(root) as {
        digestSha256: string
      }).digestSha256
    })).toThrow('GATE9C3E_PHASE_TRANSITION_DENIED')
  })

  it('blocks skipping JOB_ASSIGNED and a fake clean stop', () => {
    publishQaPreviousOwnerJournal(root, preparing())
    const first = readQaPreviousOwnerJournal(root)
    expect(first.state).toBe('QA_RECORD_UNATTESTED')
    if (first.state !== 'QA_RECORD_UNATTESTED') return
    expect(() => publishQaPreviousOwnerJournal(root, {
      ...withAssignedJob(first.digestSha256),
      phase: 'CLEAN_STOP', observedActiveProcesses: 0
    })).toThrow('GATE9C3E_PHASE_TRANSITION_DENIED')
  })

  it('blocks revision rollback and a wrong previous hash', () => {
    publishQaPreviousOwnerJournal(root, preparing())
    expect(() => publishQaPreviousOwnerJournal(root, {
      ...withAssignedJob('0'.repeat(64))
    })).toThrow('GATE9C3E_REVISION_CHAIN_UNVERIFIED')
    const first = readQaPreviousOwnerJournal(root)
    expect(first.state).toBe('QA_RECORD_UNATTESTED')
    if (first.state !== 'QA_RECORD_UNATTESTED') return
    expect(() => publishQaPreviousOwnerJournal(root, {
      ...withAssignedJob(first.digestSha256), revision: 1
    })).toThrow('GATE9C3E_REVISION_CHAIN_UNVERIFIED')
  })

  it('blocks rewriting the previous owner or motor identity mid-generation', () => {
    publishQaPreviousOwnerJournal(root, preparing())
    const first = readQaPreviousOwnerJournal(root)
    expect(first.state).toBe('QA_RECORD_UNATTESTED')
    if (first.state !== 'QA_RECORD_UNATTESTED') return
    for (const patch of [
      { owner: { pid: 9001, creationTimeTicks: '133776550123456789' } },
      { motorIdentitySha256: 'b'.repeat(64) },
      { generationId: 'd0a0ca01-2345-489a-9012-abcdef123457' }
    ]) {
      expect(() => publishQaPreviousOwnerJournal(root, {
        ...withAssignedJob(first.digestSha256), ...patch
      })).toThrow('GATE9C3E_PREVIOUS_OWNER_MISMATCH')
    }
  })

  it('treats a truncated journal as corrupt and refuses to overwrite it', () => {
    publishQaPreviousOwnerJournal(root, preparing())
    writeFileSync(join(root, GATE9C3E_QA_JOURNAL_NAME), '{"payload":')
    expect(readQaPreviousOwnerJournal(root)).toEqual({
      state: 'CORRUPT_OR_UNREADABLE'
    })
    expect(() => publishQaPreviousOwnerJournal(root, preparing()))
      .toThrow('GATE9C3E_EXISTING_JOURNAL_UNVERIFIABLE')
  })

  it('detects a JSON edit not accompanied by a matching digest', () => {
    publishQaPreviousOwnerJournal(root, preparing())
    const path = join(root, GATE9C3E_QA_JOURNAL_NAME)
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      payload: QaOwnerJournalRecord
      digestSha256: string
    }
    raw.payload.owner.pid += 1
    writeFileSync(path, JSON.stringify(raw))
    expect(readQaPreviousOwnerJournal(root).state).toBe('CORRUPT_OR_UNREADABLE')
  })

  it('rejects unsupported root paths even with the QA opt-in', () => {
    expect(() => readQaPreviousOwnerJournal(tmpdir())).toThrow('GATE9C3E_ROOT_NOT_DISPOSABLE')
  })

  it('rejects file access without the isolated QA opt-in', () => {
    delete process.env.ORCA_GATE9C3E_TEST_ONLY
    expect(() => readQaPreviousOwnerJournal(root))
      .toThrow('GATE9C3E_ISOLATED_WINDOWS_QA_ONLY')
  })

  it('requires a fresh PREPARING record and rejects forged initial close', () => {
    expect(() => publishQaPreviousOwnerJournal(root, {
      ...preparing(), phase: 'CLEAN_STOP',
      jobRoot: { pid: 90001, creationTimeTicks: '133776550123456790' },
      observedActiveProcesses: 0
    })).toThrow('GATE9C3E_FIRST_RECORD_MUST_PREPARE')
  })

  it('rejects malformed phase-specific fields without touching disk', () => {
    expect(() => publishQaPreviousOwnerJournal(root, {
      ...preparing(), observedActiveProcesses: 9
    })).toThrow('GATE9C3E_PREPARING_MUST_HAVE_NO_JOB')
    expect(readQaPreviousOwnerJournal(root)).toEqual({ state: 'MISSING' })
  })
})
