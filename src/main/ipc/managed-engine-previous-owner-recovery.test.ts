import { describe, expect, it } from 'vitest'
import {
  evaluatePreviousOwnerRecovery,
  type PreviousOwnerRecoveryBlockReason,
  type PreviousOwnerRecoveryEvidence
} from './managed-engine-previous-owner-recovery'

/** A synthetic CLEAN_STOP record, NOT an authenticated native journal. */
const verified: PreviousOwnerRecoveryEvidence = {
  platform: 'win32',
  profile: 'STAGING_LOCAL',
  evidenceSource: 'TRUSTED_NATIVE_MAIN',
  nativeMotorLease: 'HELD_THIS_PROCESS',
  motorIdentityMatchesJournal: true,
  journalIntegrity: 'ATTESTED',
  journalOwnerIdentityVerified: true,
  journalState: 'CLEAN_STOP',
  newQaRootCreationAttested: false,
  priorJobClosedByOwnHandle: true,
  priorJobActiveProcessCount: 0,
  previousRecordedProcesses: 'ALL_EXITED_VERIFIED',
  postLeaseListenerCensus: 'NO_LISTENER',
  postLeaseProcessCensus: 'NO_MATCH',
  installedEngineExecutableVerified: true,
  privateQaDataRootVerified: true,
  wcbUnchangedVerified: true
}

const blocked: ReadonlyArray<{
  name: string
  patch: Partial<PreviousOwnerRecoveryEvidence>
  reason: PreviousOwnerRecoveryBlockReason
}> = [
  { name: 'not Windows', patch: { platform: 'linux' }, reason: 'WINDOWS_ONLY' },
  { name: 'normal profile', patch: { profile: 'NORMAL' }, reason: 'STAGING_ONLY' },
  { name: 'renderer-supplied attestation', patch: { evidenceSource: 'RENDERER' }, reason: 'TRUSTED_NATIVE_EVIDENCE_REQUIRED' },
  { name: 'user-file attestation', patch: { evidenceSource: 'USER_FILE' }, reason: 'TRUSTED_NATIVE_EVIDENCE_REQUIRED' },
  { name: 'environment attestation', patch: { evidenceSource: 'ENVIRONMENT' }, reason: 'TRUSTED_NATIVE_EVIDENCE_REQUIRED' },
  { name: 'unknown evidence source', patch: { evidenceSource: 'UNKNOWN' }, reason: 'TRUSTED_NATIVE_EVIDENCE_REQUIRED' },
  { name: 'lease held elsewhere', patch: { nativeMotorLease: 'HELD_OTHER' }, reason: 'EXCLUSIVE_LEASE_NOT_HELD' },
  { name: 'lease released', patch: { nativeMotorLease: 'NOT_HELD' }, reason: 'EXCLUSIVE_LEASE_NOT_HELD' },
  { name: 'lease ownership unknown', patch: { nativeMotorLease: 'UNKNOWN' }, reason: 'EXCLUSIVE_LEASE_NOT_HELD' },
  { name: 'journal identity mismatch', patch: { motorIdentityMatchesJournal: false }, reason: 'MOTOR_JOURNAL_IDENTITY_MISMATCH' },
  { name: 'missing journal', patch: { journalIntegrity: 'MISSING' }, reason: 'PREVIOUS_OWNER_JOURNAL_UNTRUSTED' },
  { name: 'corrupt journal', patch: { journalIntegrity: 'CORRUPT' }, reason: 'PREVIOUS_OWNER_JOURNAL_UNTRUSTED' },
  { name: 'unreadable journal', patch: { journalIntegrity: 'UNREADABLE' }, reason: 'PREVIOUS_OWNER_JOURNAL_UNTRUSTED' },
  { name: 'unverified journal', patch: { journalIntegrity: 'UNVERIFIED' }, reason: 'PREVIOUS_OWNER_JOURNAL_UNTRUSTED' },
  { name: 'previous owner identity unverified', patch: { journalOwnerIdentityVerified: false }, reason: 'PREVIOUS_OWNER_IDENTITY_UNVERIFIED' },
  { name: 'previous start interrupted', patch: { journalState: 'STARTING' }, reason: 'INTERRUPTED_OWNER_REQUIRES_MANUAL_RECONCILIATION' },
  { name: 'previous motor running', patch: { journalState: 'RUNNING' }, reason: 'INTERRUPTED_OWNER_REQUIRES_MANUAL_RECONCILIATION' },
  { name: 'previous motor crashed', patch: { journalState: 'CRASHED' }, reason: 'INTERRUPTED_OWNER_REQUIRES_MANUAL_RECONCILIATION' },
  { name: 'previous state unknown', patch: { journalState: 'UNKNOWN' }, reason: 'INTERRUPTED_OWNER_REQUIRES_MANUAL_RECONCILIATION' },
  { name: 'clean stop without owned close', patch: { priorJobClosedByOwnHandle: false }, reason: 'CLEAN_STOP_JOB_CLOSE_UNVERIFIED' },
  { name: 'old job still contains processes', patch: { priorJobActiveProcessCount: 'NONZERO' }, reason: 'CLEAN_STOP_JOB_DESCENDANTS_UNVERIFIED' },
  { name: 'old job descendant count unknown', patch: { priorJobActiveProcessCount: 'UNKNOWN' }, reason: 'CLEAN_STOP_JOB_DESCENDANTS_UNVERIFIED' },
  { name: 'old recorded process running', patch: { previousRecordedProcesses: 'SOME_RUNNING' }, reason: 'RECORDED_PROCESS_STILL_RUNNING' },
  { name: 'old recorded PID reused', patch: { previousRecordedProcesses: 'SOME_REUSED' }, reason: 'RECORDED_PROCESS_PID_REUSED' },
  { name: 'old recorded processes unverifiable', patch: { previousRecordedProcesses: 'UNVERIFIED' }, reason: 'RECORDED_PROCESSES_UNVERIFIED' },
  { name: 'old recorded processes missing', patch: { previousRecordedProcesses: 'NONE_RECORDED' }, reason: 'RECORDED_PROCESSES_MISSING' },
  { name: 'listener unknown', patch: { postLeaseListenerCensus: 'UNKNOWN' }, reason: 'PREVIOUS_OWNER_LISTENER_UNVERIFIED' },
  { name: 'old listener still present', patch: { postLeaseListenerCensus: 'PRESENT' }, reason: 'PREVIOUS_OWNER_LISTENER_PRESENT' },
  { name: 'process census unknown', patch: { postLeaseProcessCensus: 'UNKNOWN' }, reason: 'PREVIOUS_OWNER_PROCESS_UNVERIFIED' },
  { name: 'old process still present', patch: { postLeaseProcessCensus: 'OLD_PROCESS_FOUND' }, reason: 'PREVIOUS_OWNER_PROCESS_PRESENT' },
  { name: 'engine executable untrusted', patch: { installedEngineExecutableVerified: false }, reason: 'ENGINE_EXECUTABLE_UNVERIFIED' },
  { name: 'data root untrusted', patch: { privateQaDataRootVerified: false }, reason: 'QA_DATA_ROOT_UNVERIFIED' },
  { name: 'WCB isolation unverifiable', patch: { wcbUnchangedVerified: false }, reason: 'WCB_ISOLATION_UNVERIFIED' }
]

describe('Gate 9B-C3-D — fail-closed prior-owner recovery qualification', () => {
  it('only qualifies a fully synthetic verified CLEAN_STOP for additional QA', () => {
    expect(evaluatePreviousOwnerRecovery(verified)).toEqual({
      state: 'READY_FOR_ADDITIONAL_ISOLATED_QA',
      reason: null
    })
  })

  it('qualifies only an attested, newly-created isolated QA root with no old process record', () => {
    expect(evaluatePreviousOwnerRecovery({
      ...verified,
      journalState: 'NEW_EMPTY_QA_ROOT',
      newQaRootCreationAttested: true,
      previousRecordedProcesses: 'NONE_RECORDED'
    })).toEqual({ state: 'READY_FOR_ADDITIONAL_ISOLATED_QA', reason: null })
  })

  it('blocks an unverified new QA root even if the journal claims no old motor', () => {
    expect(evaluatePreviousOwnerRecovery({
      ...verified,
      journalState: 'NEW_EMPTY_QA_ROOT',
      previousRecordedProcesses: 'NONE_RECORDED'
    })).toEqual({ state: 'BLOCKED', reason: 'QA_ROOT_CREATION_UNVERIFIED' })
  })

  it('blocks an inconsistent new QA root if it contains a prior recorded process', () => {
    expect(evaluatePreviousOwnerRecovery({
      ...verified,
      journalState: 'NEW_EMPTY_QA_ROOT',
      newQaRootCreationAttested: true
    })).toEqual({ state: 'BLOCKED', reason: 'RECORDED_PROCESSES_UNVERIFIED' })
  })

  it.each(blocked)('blocks $name', ({ patch, reason }) => {
    expect(evaluatePreviousOwnerRecovery({ ...verified, ...patch })).toEqual({
      state: 'BLOCKED', reason
    })
  })

  it('is deterministic with frozen input and cannot mutate the owner record', () => {
    const frozen = Object.freeze({ ...verified })
    expect(evaluatePreviousOwnerRecovery(frozen)).toEqual(
      evaluatePreviousOwnerRecovery(frozen)
    )
    expect(frozen.journalState).toBe('CLEAN_STOP')
  })
})
