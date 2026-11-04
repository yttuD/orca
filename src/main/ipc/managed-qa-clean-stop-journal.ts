/**
 * ORCA-D02 Gate 9B-C3-E-D: QA-only *current-owner* clean-close/journal link.
 *
 * Uses only an already-held native mutex, an *original* private Job Object
 * returned by this same addon and the isolated synthetic QA journal.
 * No IPC exposure; no production FastAPI or WCB actions.
 *
 * Operational warning: no authenticity, rollback resistance or durable
 * attestation for a previous owner. In particular, a crash between native
 * close and the journal write leaves JOB_ASSIGNED and BLOCKS recovery.
 */
import { loadWindowsSecurity } from '../../shared/windows-security-addon'
import type {
  ManagedJobContainedProcess,
  ManagedMotorLeaseHandle,
  ManagedQaRecordedCleanCloseResult
} from '../../../native/windows-security'
import {
  readQaPreviousOwnerJournal,
  type QaOwnerJournalRecord
} from './managed-previous-owner-journal-qa'
import {
  publishQaPreviousOwnerJournalWithNativeLease
} from './managed-previous-owner-lease-journal-qa'

export type QaCleanStopJournalDecision =
  | {
      readonly state: 'BLOCKED'
      readonly reason:
        | 'NATIVE_ADDON_UNAVAILABLE'
        | 'UNTRUSTED_OR_MISSING_JOURNAL'
        | 'JOURNAL_NOT_JOB_ASSIGNED'
        | 'NATIVE_LEASE_MISMATCH'
        | 'NATIVE_JOB_CLEAN_CLOSE_REFUSED'
      readonly nativeCloseState?: ManagedQaRecordedCleanCloseResult['state']
    }
  | {
      readonly state: 'QA_CLEAN_STOP_PERSISTED_UNATTESTED'
      readonly revision: number
      readonly nativeCloseState: 'CLOSED_EMPTY_QA_ONLY'
    }

/**
 * Invoked only with synthetic test-owned handles. Read/validate the assigned
 * generation BEFORE touching the native Job Object. A fabricated object with
 * a copied JS prototype cannot invoke the actual native close primitive.
 *
 * If the file publication fails after close, throw and leave previous journal
 * phase as JOB_ASSIGNED. Callers must not downgrade it to CLEAN_STOP.
 */
export function closeOwnedQaJobAndPersistUnattestedStop(
  root: string,
  lease: ManagedMotorLeaseHandle,
  job: ManagedJobContainedProcess
): QaCleanStopJournalDecision {
  const loaded = loadWindowsSecurity()
  if ('error' in loaded ||
      !loaded.addon.hasNativeExport('verifyManagedMotorLeaseOwnerForQa') ||
      !loaded.addon.hasNativeExport('closeRecordedManagedJobIfEmptyForQa')) {
    return { state: 'BLOCKED', reason: 'NATIVE_ADDON_UNAVAILABLE' }
  }

  const current = readQaPreviousOwnerJournal(root)
  if (current.state !== 'QA_RECORD_UNATTESTED') {
    return { state: 'BLOCKED', reason: 'UNTRUSTED_OR_MISSING_JOURNAL' }
  }
  const recorded = current.record
  if (recorded.phase !== 'JOB_ASSIGNED' ||
      recorded.revision !== 2 || recorded.jobRoot === null) {
    return { state: 'BLOCKED', reason: 'JOURNAL_NOT_JOB_ASSIGNED' }
  }

  const proof = loaded.addon.verifyManagedMotorLeaseOwnerForQa(
    lease, recorded.motorIdentitySha256
  )
  if (!proof.verified ||
      proof.ownerPid !== recorded.owner.pid ||
      proof.ownerCreationTimeTicks !== recorded.owner.creationTimeTicks ||
      proof.ownerPid !== process.pid) {
    return { state: 'BLOCKED', reason: 'NATIVE_LEASE_MISMATCH' }
  }

  // Native validates this specific *real* type-tagged Job Object as well as
  // exact PID+creation before checking its actual root HANDLE and member
  // count. Do not invoke the overridable job.closeIfEmptyForQa JS property.
  const clean = loaded.addon.closeRecordedManagedJobIfEmptyForQa(
    job, recorded.jobRoot.pid, recorded.jobRoot.creationTimeTicks
  )
  if (clean.state !== 'CLOSED_EMPTY_QA_ONLY') {
    return {
      state: 'BLOCKED',
      reason: 'NATIVE_JOB_CLEAN_CLOSE_REFUSED',
      nativeCloseState: clean.state
    }
  }

  // Persist only the state actually returned by the owned native close.
  // The journal remains UNATTESTED even when this exact QA call succeeds.
  const stop: QaOwnerJournalRecord = {
    ...recorded,
    phase: 'CLEAN_STOP',
    revision: recorded.revision + 1,
    previousDigest: current.digestSha256,
    observedActiveProcesses: clean.observedActiveProcesses,
    recordedAt: new Date().toISOString()
  }
  const persisted = publishQaPreviousOwnerJournalWithNativeLease(root, stop, lease)
  return {
    state: 'QA_CLEAN_STOP_PERSISTED_UNATTESTED',
    revision: persisted.revision,
    nativeCloseState: 'CLOSED_EMPTY_QA_ONLY'
  }
}
