/**
 * ORCA-D02 Gate 9B-C3 — PURE post-lease service reconciliation contract.
 *
 * No socket probing, no filesystem inspection, no Win32 API calls, no process
 * adoption or termination. All attestations must eventually be produced by
 * trusted Electron main/native code; renderer/IPC-provided values are untrusted.
 * A positive result is only eligibility for *further disposable staging QA*,
 * never authority to start the operational Python motor.
 */
export type MotorReconciliationEvidence = {
  readonly platform: NodeJS.Platform
  readonly profile: 'NORMAL' | 'STAGING_LOCAL'
  readonly identitySource: 'TRUSTED_MAIN_NATIVE' | 'RENDERER' | 'ENV_ONLY' | 'UNKNOWN'
  /** Canonical, established installation identity: not only an arbitrary hash. */
  readonly installationIdentityVerified: boolean
  readonly executableIdentityVerified: boolean
  readonly qaCheckoutIsolated: boolean
  readonly dataRootIsolatedAndPrivate: boolean
  readonly lease:
    | 'NATIVE_HELD_BY_THIS_PROCESS'
    | 'HELD_BY_OTHER'
    | 'RELEASED'
    | 'UNKNOWN'
  readonly leaseIdentityMatchesEngine: boolean
  readonly leaseGenerationVerified: boolean
  readonly port:
    | 'STAGING_EPHEMERAL'
    | 'RESERVED_OPERATIONAL'
    | 'INVALID'
  /** Must follow, not precede, acquisition of the lease. */
  readonly censusOrder: 'AFTER_LEASE' | 'BEFORE_LEASE' | 'UNKNOWN'
  readonly listener:
    | 'NO_LISTENER'
    | 'KNOWN_OWN_LISTENER'
    | 'FOREIGN_LISTENER'
    | 'UNKNOWN'
  readonly processTree:
    | 'NO_OLD_OWNER'
    | 'OLD_OWNED_TREE'
    | 'FOREIGN_TREE'
    | 'UNKNOWN'
  readonly oldJobObjectState:
    | 'NO_REMAINDER'
    | 'ACTIVE_DESCENDANTS'
    | 'UNKNOWN'
  readonly wcbProcessesUnchanged: boolean
}

export type ReconciliationBlockReason =
  | 'WINDOWS_ONLY'
  | 'STAGING_FIRST'
  | 'UNTRUSTED_IDENTITY_SOURCE'
  | 'INSTALLATION_UNVERIFIED'
  | 'EXECUTABLE_UNVERIFIED'
  | 'QA_CHECKOUT_NOT_ISOLATED'
  | 'DATA_ROOT_NOT_ISOLATED'
  | 'LEASE_NOT_HELD'
  | 'LEASE_TARGET_MISMATCH'
  | 'LEASE_GENERATION_UNVERIFIED'
  | 'RESERVED_OR_INVALID_PORT'
  | 'CENSUS_NOT_AFTER_LEASE'
  | 'FOREIGN_OR_EXISTING_LISTENER'
  | 'LISTENER_UNKNOWN'
  | 'OLD_OR_FOREIGN_PROCESS_TREE'
  | 'PROCESS_TREE_UNKNOWN'
  | 'OLD_JOB_OBJECT_STILL_ACTIVE'
  | 'JOB_OBJECT_STATE_UNKNOWN'
  | 'WCB_ISOLATION_UNVERIFIED'

export type ReconciliationDecision =
  | { readonly state: 'BLOCKED'; readonly reason: ReconciliationBlockReason }
  | { readonly state: 'READY_FOR_DISPOSABLE_STAGING_QA'; readonly reason: null }

export function evaluateMotorReconciliation(
  e: MotorReconciliationEvidence
): ReconciliationDecision {
  const deny = (reason: ReconciliationBlockReason): ReconciliationDecision =>
    ({ state: 'BLOCKED', reason })
  if (e.platform !== 'win32') return deny('WINDOWS_ONLY')
  if (e.profile !== 'STAGING_LOCAL') return deny('STAGING_FIRST')
  if (e.identitySource !== 'TRUSTED_MAIN_NATIVE') return deny('UNTRUSTED_IDENTITY_SOURCE')
  if (!e.installationIdentityVerified) return deny('INSTALLATION_UNVERIFIED')
  if (!e.executableIdentityVerified) return deny('EXECUTABLE_UNVERIFIED')
  if (!e.qaCheckoutIsolated) return deny('QA_CHECKOUT_NOT_ISOLATED')
  if (!e.dataRootIsolatedAndPrivate) return deny('DATA_ROOT_NOT_ISOLATED')
  if (e.lease !== 'NATIVE_HELD_BY_THIS_PROCESS') return deny('LEASE_NOT_HELD')
  if (!e.leaseIdentityMatchesEngine) return deny('LEASE_TARGET_MISMATCH')
  if (!e.leaseGenerationVerified) return deny('LEASE_GENERATION_UNVERIFIED')
  if (e.port !== 'STAGING_EPHEMERAL') return deny('RESERVED_OR_INVALID_PORT')
  if (e.censusOrder !== 'AFTER_LEASE') return deny('CENSUS_NOT_AFTER_LEASE')
  if (e.listener === 'UNKNOWN') return deny('LISTENER_UNKNOWN')
  if (e.listener !== 'NO_LISTENER') return deny('FOREIGN_OR_EXISTING_LISTENER')
  if (e.processTree === 'UNKNOWN') return deny('PROCESS_TREE_UNKNOWN')
  if (e.processTree !== 'NO_OLD_OWNER') return deny('OLD_OR_FOREIGN_PROCESS_TREE')
  if (e.oldJobObjectState === 'UNKNOWN') return deny('JOB_OBJECT_STATE_UNKNOWN')
  if (e.oldJobObjectState !== 'NO_REMAINDER') return deny('OLD_JOB_OBJECT_STILL_ACTIVE')
  if (!e.wcbProcessesUnchanged) return deny('WCB_ISOLATION_UNVERIFIED')
  // Pure verdict; a future native authority must independently establish
  // every assertion, then do an atomic bind under the held lease.
  return { state: 'READY_FOR_DISPOSABLE_STAGING_QA', reason: null }
}
