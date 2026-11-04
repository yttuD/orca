/**
 * ORCA-D02 Gate 9B-C3-E-B — QA-only journal write fenced by a live native
 * Windows mutex owner. Not an operational motor start grant.
 *
 * We verify an actual native ObjectWrap lease and owner pid+Win32 FILETIME,
 * instead of trusting a forgeable JS snapshot. The guard is synchronous:
 * no JS event-loop yield between the pre/post checks and journal publication.
 * This is still NOT an authenticated historical journal or durable fencing
 * against same-user file substitution, rollback or independent writers.
 */
import { loadWindowsSecurity } from '../../shared/windows-security-addon'
import {
  publishQaPreviousOwnerJournal,
  type QaOwnerJournalRecord
} from './managed-previous-owner-journal-qa'
import type { ManagedMotorLeaseHandle } from '../../../native/windows-security'

type QaLeasePublication = {
  readonly state: 'QA_PERSISTED_UNATTESTED'
  readonly revision: number
  readonly ownerLeaseChecked: true
}

function assertNativeQaOwner(
  lease: ManagedMotorLeaseHandle,
  record: QaOwnerJournalRecord
): void {
  const loaded = loadWindowsSecurity()
  if ('error' in loaded) throw new Error('GATE9C3EB_NATIVE_ADDON_UNAVAILABLE')
  if (!loaded.addon.hasNativeExport('verifyManagedMotorLeaseOwnerForQa')) {
    throw new Error('GATE9C3EB_NATIVE_OWNER_VERIFIER_MISSING')
  }
  const proof = loaded.addon.verifyManagedMotorLeaseOwnerForQa(
    lease, record.motorIdentitySha256
  )
  if (!proof.verified) throw new Error('GATE9C3EB_NATIVE_LEASE_NOT_OWNED')
  if (
    proof.ownerPid !== process.pid ||
    proof.ownerPid !== record.owner.pid ||
    proof.ownerCreationTimeTicks !== record.owner.creationTimeTicks
  ) {
    throw new Error('GATE9C3EB_OWNER_IDENTITY_MISMATCH')
  }
}

/**
 * For disposable QA only. Throws if no real native lease is owned on this
 * thread, the motor digest differs, the owner identity is mismatched or the
 * persisted journal is corrupt/inconsistent. No motor starts, no IPC.
 *
 * A successful call is UNATTESTED telemetry, NEVER evidence to mark a real
 * previous owner CLEAN_STOP or to authorize recovery after a crash.
 */
export function publishQaPreviousOwnerJournalWithNativeLease(
  root: string,
  record: QaOwnerJournalRecord,
  lease: ManagedMotorLeaseHandle
): QaLeasePublication {
  assertNativeQaOwner(lease, record)
  const saved = publishQaPreviousOwnerJournal(root, record)
  // Synchronous guarded call; if the native lease unexpectedly disappears,
  // block the caller rather than treating the persisted telemetry as trusted.
  assertNativeQaOwner(lease, record)
  return { ...saved, ownerLeaseChecked: true }
}
