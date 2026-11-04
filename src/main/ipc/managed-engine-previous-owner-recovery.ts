/**
 * ORCA-D02 Gate 9B-C3-D — PURE, fail-closed previous-owner recovery policy.
 *
 * Does not read/write a journal, inspect a process/Job Object, acquire a
 * mutex, or permit operational engine startup.
 *
 * A private *unnamed* Windows Job Object cannot be reopened by a new
 * process after the previous owner and its handles are gone. A vanished PID
 * is NEVER sufficient proof that every descendant has exited. Therefore an
 * interrupted/unknown owner is quarantined until a SEPARATE, trusted native
 * recovery procedure can establish additional evidence.
 */
export type PreviousOwnerRecoveryEvidence = {
  readonly platform: NodeJS.Platform
  readonly profile: 'STAGING_LOCAL' | 'NORMAL'
  readonly evidenceSource:
    | 'TRUSTED_NATIVE_MAIN'
    | 'RENDERER'
    | 'USER_FILE'
    | 'ENVIRONMENT'
    | 'UNKNOWN'
  /** Lease must remain held during the entire follow-on qualification. */
  readonly nativeMotorLease: 'HELD_THIS_PROCESS' | 'HELD_OTHER' | 'NOT_HELD' | 'UNKNOWN'
  readonly motorIdentityMatchesJournal: boolean
  readonly journalIntegrity:
    | 'ATTESTED'
    | 'MISSING'
    | 'CORRUPT'
    | 'UNREADABLE'
    | 'UNVERIFIED'
  /** Includes exact generation and Win32 creation FILETIME, not only a PID. */
  readonly journalOwnerIdentityVerified: boolean
  readonly journalState:
    | 'NEW_EMPTY_QA_ROOT'
    | 'CLEAN_STOP'
    | 'STARTING'
    | 'RUNNING'
    | 'CRASHED'
    | 'UNKNOWN'
  /** For NEW_EMPTY, attest atomic root creation and no pre-existing state. */
  readonly newQaRootCreationAttested: boolean
  /** For CLEAN_STOP, record only a close owned by the same proven generation. */
  readonly priorJobClosedByOwnHandle: boolean
  readonly priorJobActiveProcessCount: 0 | 'NONZERO' | 'UNKNOWN'
  readonly previousRecordedProcesses:
    | 'ALL_EXITED_VERIFIED'
    | 'SOME_RUNNING'
    | 'SOME_REUSED'
    | 'UNVERIFIED'
    | 'NONE_RECORDED'
  readonly postLeaseListenerCensus: 'NO_LISTENER' | 'PRESENT' | 'UNKNOWN'
  readonly postLeaseProcessCensus: 'NO_MATCH' | 'OLD_PROCESS_FOUND' | 'UNKNOWN'
  readonly installedEngineExecutableVerified: boolean
  readonly privateQaDataRootVerified: boolean
  readonly wcbUnchangedVerified: boolean
}

export type PreviousOwnerRecoveryBlockReason =
  | 'WINDOWS_ONLY'
  | 'STAGING_ONLY'
  | 'TRUSTED_NATIVE_EVIDENCE_REQUIRED'
  | 'EXCLUSIVE_LEASE_NOT_HELD'
  | 'MOTOR_JOURNAL_IDENTITY_MISMATCH'
  | 'PREVIOUS_OWNER_JOURNAL_UNTRUSTED'
  | 'PREVIOUS_OWNER_IDENTITY_UNVERIFIED'
  | 'INTERRUPTED_OWNER_REQUIRES_MANUAL_RECONCILIATION'
  | 'QA_ROOT_CREATION_UNVERIFIED'
  | 'CLEAN_STOP_JOB_CLOSE_UNVERIFIED'
  | 'CLEAN_STOP_JOB_DESCENDANTS_UNVERIFIED'
  | 'RECORDED_PROCESS_STILL_RUNNING'
  | 'RECORDED_PROCESS_PID_REUSED'
  | 'RECORDED_PROCESSES_UNVERIFIED'
  | 'RECORDED_PROCESSES_MISSING'
  | 'PREVIOUS_OWNER_LISTENER_PRESENT'
  | 'PREVIOUS_OWNER_LISTENER_UNVERIFIED'
  | 'PREVIOUS_OWNER_PROCESS_PRESENT'
  | 'PREVIOUS_OWNER_PROCESS_UNVERIFIED'
  | 'ENGINE_EXECUTABLE_UNVERIFIED'
  | 'QA_DATA_ROOT_UNVERIFIED'
  | 'WCB_ISOLATION_UNVERIFIED'

export type PreviousOwnerRecoveryDecision =
  | { readonly state: 'BLOCKED'; readonly reason: PreviousOwnerRecoveryBlockReason }
  | { readonly state: 'READY_FOR_ADDITIONAL_ISOLATED_QA'; readonly reason: null }

/**
 * Positive verdict only expresses logical eligibility for MORE QA. Inputs
 * alone are forgeable JS values. Native main must establish their source.
 * NEVER connect this verdict to an actual production motor spawn or IPC.
 */
export function evaluatePreviousOwnerRecovery(
  e: PreviousOwnerRecoveryEvidence
): PreviousOwnerRecoveryDecision {
  const block = (reason: PreviousOwnerRecoveryBlockReason): PreviousOwnerRecoveryDecision =>
    ({ state: 'BLOCKED', reason })
  if (e.platform !== 'win32') return block('WINDOWS_ONLY')
  if (e.profile !== 'STAGING_LOCAL') return block('STAGING_ONLY')
  if (e.evidenceSource !== 'TRUSTED_NATIVE_MAIN') {
    return block('TRUSTED_NATIVE_EVIDENCE_REQUIRED')
  }
  if (e.nativeMotorLease !== 'HELD_THIS_PROCESS') {
    return block('EXCLUSIVE_LEASE_NOT_HELD')
  }
  if (!e.motorIdentityMatchesJournal) return block('MOTOR_JOURNAL_IDENTITY_MISMATCH')
  if (e.journalIntegrity !== 'ATTESTED') return block('PREVIOUS_OWNER_JOURNAL_UNTRUSTED')
  if (!e.journalOwnerIdentityVerified) return block('PREVIOUS_OWNER_IDENTITY_UNVERIFIED')
  // Even a kill-on-close Job Object does not make a disappeared *root* PID
  // an authoritative complete descendant census in the new process.
  if (e.journalState !== 'NEW_EMPTY_QA_ROOT' && e.journalState !== 'CLEAN_STOP') {
    return block('INTERRUPTED_OWNER_REQUIRES_MANUAL_RECONCILIATION')
  }
  if (e.journalState === 'NEW_EMPTY_QA_ROOT') {
    if (!e.newQaRootCreationAttested) return block('QA_ROOT_CREATION_UNVERIFIED')
    if (e.previousRecordedProcesses !== 'NONE_RECORDED') {
      return block('RECORDED_PROCESSES_UNVERIFIED')
    }
  } else {
    if (!e.priorJobClosedByOwnHandle) return block('CLEAN_STOP_JOB_CLOSE_UNVERIFIED')
    if (e.priorJobActiveProcessCount !== 0) {
      return block('CLEAN_STOP_JOB_DESCENDANTS_UNVERIFIED')
    }
    if (e.previousRecordedProcesses === 'SOME_RUNNING') {
      return block('RECORDED_PROCESS_STILL_RUNNING')
    }
    if (e.previousRecordedProcesses === 'SOME_REUSED') {
      return block('RECORDED_PROCESS_PID_REUSED')
    }
    if (e.previousRecordedProcesses === 'UNVERIFIED') {
      return block('RECORDED_PROCESSES_UNVERIFIED')
    }
    if (e.previousRecordedProcesses !== 'ALL_EXITED_VERIFIED') {
      return block('RECORDED_PROCESSES_MISSING')
    }
  }
  if (e.postLeaseListenerCensus === 'UNKNOWN') {
    return block('PREVIOUS_OWNER_LISTENER_UNVERIFIED')
  }
  if (e.postLeaseListenerCensus !== 'NO_LISTENER') {
    return block('PREVIOUS_OWNER_LISTENER_PRESENT')
  }
  if (e.postLeaseProcessCensus === 'UNKNOWN') {
    return block('PREVIOUS_OWNER_PROCESS_UNVERIFIED')
  }
  if (e.postLeaseProcessCensus !== 'NO_MATCH') {
    return block('PREVIOUS_OWNER_PROCESS_PRESENT')
  }
  if (!e.installedEngineExecutableVerified) {
    return block('ENGINE_EXECUTABLE_UNVERIFIED')
  }
  if (!e.privateQaDataRootVerified) return block('QA_DATA_ROOT_UNVERIFIED')
  if (!e.wcbUnchangedVerified) return block('WCB_ISOLATION_UNVERIFIED')
  return { state: 'READY_FOR_ADDITIONAL_ISOLATED_QA', reason: null }
}
