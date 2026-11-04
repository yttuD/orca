/**
 * ORCA-D02 Gate 9B: PURE, fail-closed Windows motor admission contract.
 *
 * This module does NOT spawn, bind ports, inspect credentials or terminate
 * processes. A "READY_FOR_WINDOWS_QUALIFICATION" result is only permission to
 * conduct *further QA*, never permission to start a production motor.
 *
 * IMPORTANT: Inputs are evidence from trusted Electron-main/native code.
 * Renderer-supplied strings/booleans must never be treated as attestations.
 */
export type EngineAdmissionEvidence = {
  readonly platform: NodeJS.Platform
  readonly profile: 'NORMAL' | 'STAGING_LOCAL'
  /** Verified native operator gesture in main, not a renderer boolean. */
  readonly nativeApprovalVerified: boolean
  readonly executableAndInstallTrusted: boolean
  readonly dedicatedDataRootVerified: boolean
  readonly orphanAndPortCensus:
    | 'NO_LISTENER_AND_NO_OWNER'
    | 'OWNED_INSTANCE'
    | 'FOREIGN_INSTANCE'
    | 'UNVERIFIED'
  readonly exclusiveStartupLeaseHeld: boolean
  readonly suspendedSpawnAvailable: boolean
  readonly nativeJobObjectAvailable: boolean
  readonly jobKillOnLastHandleClose: boolean
  readonly descendantsContainedByJob: boolean
  readonly processIdentityWithCreationTime: boolean
  readonly wcbAndExistingProcessesIsolated: boolean
  readonly rollbackAndCrashRecoveryValidated: boolean
}

export type EngineAdmissionBlockReason =
  | 'WINDOWS_ONLY'
  | 'STAGING_FIRST'
  | 'NATIVE_OPERATOR_APPROVAL_REQUIRED'
  | 'UNTRUSTED_INSTALL'
  | 'DATA_ISOLATION_UNVERIFIED'
  | 'FOREIGN_INSTANCE_PRESENT'
  | 'INCUMBENT_OWNERSHIP_UNVERIFIED'
  | 'EXCLUSIVE_LEASE_REQUIRED'
  | 'SUSPENDED_SPAWN_UNAVAILABLE'
  | 'WIN32_JOB_OBJECT_UNAVAILABLE'
  | 'JOB_KILL_ON_CLOSE_UNVERIFIED'
  | 'DESCENDANT_CONTAINMENT_UNVERIFIED'
  | 'PROCESS_CREATION_IDENTITY_UNVERIFIED'
  | 'WCB_ISOLATION_UNVERIFIED'
  | 'CRASH_RECOVERY_UNVERIFIED'

export type EngineAdmissionDecision =
  | { readonly state: 'BLOCKED'; readonly reason: EngineAdmissionBlockReason }
  | { readonly state: 'READY_FOR_WINDOWS_QUALIFICATION'; readonly reason: null }

/**
 * Gate 9B is staging-only until all native Windows host evidence has been
 * established. It must not be connected to a production spawn IPC until
 * approval/lease/job-object proofs are independently provided.
 */
export function evaluateOperationalEngineAdmission(
  evidence: EngineAdmissionEvidence
): EngineAdmissionDecision {
  const block = (reason: EngineAdmissionBlockReason): EngineAdmissionDecision =>
    ({ state: 'BLOCKED', reason })

  if (evidence.platform !== 'win32') return block('WINDOWS_ONLY')
  if (evidence.profile !== 'STAGING_LOCAL') return block('STAGING_FIRST')
  if (evidence.nativeApprovalVerified !== true) return block('NATIVE_OPERATOR_APPROVAL_REQUIRED')
  if (evidence.executableAndInstallTrusted !== true) return block('UNTRUSTED_INSTALL')
  if (evidence.dedicatedDataRootVerified !== true) return block('DATA_ISOLATION_UNVERIFIED')
  if (evidence.orphanAndPortCensus === 'FOREIGN_INSTANCE') return block('FOREIGN_INSTANCE_PRESENT')
  if (evidence.orphanAndPortCensus !== 'NO_LISTENER_AND_NO_OWNER') {
    return block('INCUMBENT_OWNERSHIP_UNVERIFIED')
  }
  if (evidence.exclusiveStartupLeaseHeld !== true) return block('EXCLUSIVE_LEASE_REQUIRED')
  if (evidence.suspendedSpawnAvailable !== true) return block('SUSPENDED_SPAWN_UNAVAILABLE')
  if (evidence.nativeJobObjectAvailable !== true) return block('WIN32_JOB_OBJECT_UNAVAILABLE')
  if (evidence.jobKillOnLastHandleClose !== true) return block('JOB_KILL_ON_CLOSE_UNVERIFIED')
  if (evidence.descendantsContainedByJob !== true) return block('DESCENDANT_CONTAINMENT_UNVERIFIED')
  if (evidence.processIdentityWithCreationTime !== true) {
    return block('PROCESS_CREATION_IDENTITY_UNVERIFIED')
  }
  if (evidence.wcbAndExistingProcessesIsolated !== true) return block('WCB_ISOLATION_UNVERIFIED')
  if (evidence.rollbackAndCrashRecoveryValidated !== true) return block('CRASH_RECOVERY_UNVERIFIED')

  // Does not start anything! This says only that a separate Windows
  // qualification step is eligible to begin.
  return { state: 'READY_FOR_WINDOWS_QUALIFICATION', reason: null }
}
