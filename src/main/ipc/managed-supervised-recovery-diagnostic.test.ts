import { describe, expect, it } from 'vitest'
import {
  projectSupervisedRecoveryDiagnostic
} from './managed-supervised-recovery-diagnostic'

// C4-A is pure and host-independent. The "observations" below are entirely
// synthetic values: no real lease, journal, port, executable or WCB access.
const NOW = 1793790000000
const good = () => ({
  source: 'MAIN_NATIVE_CLAIM',
  observedAtMs: NOW - 1000,
  journalPhase: 'CLEAN_STOP',
  lease: 'HELD_THIS_PROCESS',
  listener: 'NO_LISTENER_OBSERVED',
  recordedProcess: 'NO_MATCH_OBSERVED',
  owner: {
    generationId: 'd0a0ca01-2345-489a-9012-abcdef123456',
    pid: 12345,
    creationTimeTicks: '133776550123456789'
  }
})

describe('Gate 9B-C4-A — supervised recovery diagnosis is read-only and never authorizes startup', () => {
  it('never grants a new engine start even for favorable, freshly claimed evidence', () => {
    const view = projectSupervisedRecoveryDiagnostic(good(), NOW)
    expect(view).toMatchObject({
      status: 'BLOCKED',
      startupAllowed: false,
      reviewRequired: true,
      diagnosticOnly: true,
      evidenceAuthentication: 'UNATTESTED',
      freshness: 'RECENT_CLAIM_UNATTESTED'
    })
    expect(view.reasons).toContain('HISTORICAL_CLEAN_STOP_UNATTESTED')
  })

  it('preserves PID and full FILETIME together, never converting the ticks to a JS number', () => {
    const view = projectSupervisedRecoveryDiagnostic(good(), NOW)
    expect(view.owner).toEqual({
      generationId: 'd0a0ca01-2345-489a-9012-abcdef123456',
      pid: 12345,
      creationTimeTicks: '133776550123456789'
    })
    expect(typeof view.owner.creationTimeTicks).toBe('string')
  })

  it('blocks synthetic PREPARING as an interrupted owner', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), journalPhase: 'PREPARING'
    }, NOW)
    expect(view.reasons).toContain('PREVIOUS_OWNER_NOT_CLEAN')
    expect(view.startupAllowed).toBe(false)
  })

  it('blocks synthetic JOB_ASSIGNED despite all other claims being favorable', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), journalPhase: 'JOB_ASSIGNED'
    }, NOW)
    expect(view.reasons).toContain('PREVIOUS_OWNER_NOT_CLEAN')
    expect(view.startupAllowed).toBe(false)
  })

  it('treats MISSING journal as blocked and not as a fresh install', () => {
    expect(projectSupervisedRecoveryDiagnostic({
      ...good(), journalPhase: 'MISSING'
    }, NOW).reasons).toContain('HISTORICAL_JOURNAL_MISSING')
  })

  it('treats CORRUPT journal as blocked and never silently repairs it', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), journalPhase: 'CORRUPT'
    }, NOW)
    expect(view.reasons).toContain('HISTORICAL_JOURNAL_CORRUPT')
    expect(view.startupAllowed).toBe(false)
  })

  it('rejects malformed and unrecognized journal values', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), journalPhase: 'ATTESTED'
    }, NOW)
    expect(view.journalPhase).toBe('UNKNOWN')
    expect(view.reasons).toContain('JOURNAL_STATE_UNKNOWN')
  })

  it('ignores all stale running/absence snapshots after 15 seconds', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), observedAtMs: NOW - 15_001
    }, NOW)
    expect(view.freshness).toBe('STALE_OR_INVALID')
    expect(view.lease).toBe('UNKNOWN')
    expect(view.listener).toBe('UNKNOWN')
    expect(view.recordedProcess).toBe('UNKNOWN')
    expect(view.owner.pid).toBeNull()
    expect(view.reasons).toContain('OBSERVATION_STALE_OR_INVALID')
  })

  it('rejects future-dated observations rather than treating them as fresh', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), observedAtMs: NOW + 1
    }, NOW)
    expect(view.freshness).toBe('STALE_OR_INVALID')
    expect(view.listener).toBe('UNKNOWN')
  })

  it('treats a missing capture timestamp as UNKNOWN', () => {
    const { observedAtMs: _ignored, ...withoutTimestamp } = good()
    const view = projectSupervisedRecoveryDiagnostic(withoutTimestamp, NOW)
    expect(view.freshness).toBe('STALE_OR_INVALID')
    expect(view.lease).toBe('UNKNOWN')
  })

  it('does not give renderer-sourced data native credibility', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), source: 'RENDERER'
    }, NOW)
    expect(view.observationSource).toBe('RENDERER')
    expect(view.reasons).toContain('OBSERVATION_SOURCE_UNTRUSTED')
    expect(view.startupAllowed).toBe(false)
  })

  it('does not grant authority to an untrusted JSON file even if its values mimic native evidence', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), source: 'UNATTESTED_FILE'
    }, NOW)
    expect(view.reasons).toContain('OBSERVATION_SOURCE_UNTRUSTED')
    expect(view.evidenceAuthentication).toBe('UNATTESTED')
  })

  it('removes a recycled or invalid PID instead of presenting it without matching FILETIME', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), owner: { ...good().owner, pid: 0 }
    }, NOW)
    expect(view.owner).toEqual({
      generationId: null, pid: null, creationTimeTicks: null
    })
    expect(view.reasons).toContain('OWNER_IDENTITY_UNVERIFIED')
  })

  it('removes fractional or nonnumeric creation timestamps along with the owner PID', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), owner: { ...good().owner, creationTimeTicks: '1.337e17' }
    }, NOW)
    expect(view.owner.pid).toBeNull()
    expect(view.owner.creationTimeTicks).toBeNull()
  })

  it('does not trust a missing or malformed owner generation identity', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), owner: { ...good().owner, generationId: 'fake-generation' }
    }, NOW)
    expect(view.owner.generationId).toBeNull()
    expect(view.reasons).toContain('OWNER_IDENTITY_UNVERIFIED')
  })

  it('reports foreign listeners and old processes as blockers', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), listener: 'PRESENT', recordedProcess: 'OLD_PROCESS_FOUND'
    }, NOW)
    expect(view.reasons).toContain('LISTENER_PRESENT_OR_UNVERIFIED')
    expect(view.reasons).toContain('PREVIOUS_PROCESS_PRESENT_OR_UNVERIFIED')
  })

  it('treats a reused PID as a blocker, never an empty process tree', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), recordedProcess: 'PID_REUSED'
    }, NOW)
    expect(view.recordedProcess).toBe('PID_REUSED')
    expect(view.reasons).toContain('PREVIOUS_PROCESS_PRESENT_OR_UNVERIFIED')
  })

  it('never serializes arbitrary file paths, tokens, passwords or raw environment keys', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(),
      filePath: 'C:\\private\\credentials.json',
      token: 'SUPER_SECRET_VALUE',
      processExecutablePath: 'C:\\private\\motor.exe',
      owner: { ...good().owner, password: 'OWNER_SECRET' }
    }, NOW)
    const text = JSON.stringify(view)
    expect(text).not.toContain('SUPER_SECRET_VALUE')
    expect(text).not.toContain('OWNER_SECRET')
    expect(text).not.toContain('credentials.json')
    expect(text).not.toContain('motor.exe')
  })

  it('keeps synthetic input frozen and is deterministic for the same captured time', () => {
    const v = Object.freeze({ ...good(), owner: Object.freeze({ ...good().owner }) })
    expect(projectSupervisedRecoveryDiagnostic(v, NOW))
      .toEqual(projectSupervisedRecoveryDiagnostic(v, NOW))
    expect(v.owner.pid).toBe(12345)
  })

  it('accepts a 15-second-old claim only for display and still blocks startup', () => {
    const view = projectSupervisedRecoveryDiagnostic({
      ...good(), observedAtMs: NOW - 15_000
    }, NOW)
    expect(view.freshness).toBe('RECENT_CLAIM_UNATTESTED')
    expect(view.startupAllowed).toBe(false)
  })

  it('treats an invalid current clock as stale, never accepting a spoofed timestamp', () => {
    const view = projectSupervisedRecoveryDiagnostic(good(), Number.NaN)
    expect(view.freshness).toBe('STALE_OR_INVALID')
    expect(view.listener).toBe('UNKNOWN')
    expect(view.status).toBe('BLOCKED')
  })

  it('denies an arbitrary malformed input without throwing or side effects', () => {
    const view = projectSupervisedRecoveryDiagnostic('not-an-observation', NOW)
    expect(view).toMatchObject({
      status: 'BLOCKED',
      journalPhase: 'UNKNOWN',
      lease: 'UNKNOWN',
      listener: 'UNKNOWN',
      recordedProcess: 'UNKNOWN',
      startupAllowed: false
    })
  })
})
