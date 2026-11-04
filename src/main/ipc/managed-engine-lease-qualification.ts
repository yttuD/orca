/**
 * ORCA-D02 Gate 9B-C2 — PURE, side-effect-free lease qualification policy.
 *
 * This module DOES NOT acquire a lock, issue a native API call, spawn any
 * process, or give permission to start an operational motor. Its input is a
 * hypothetical proof contract to be supplied and authenticated by a FUTURE
 * native Windows owner, never by renderer/preload/IPC arguments.
 *
 * The existing Electron single-instance and orcad profile locks are not
 * sufficient evidence: distinct app profiles can target the same motor.
 */
export type MotorLeaseEvidence = {
  readonly platform: NodeJS.Platform
  readonly profile: 'NORMAL' | 'STAGING_LOCAL'
  /** Trust source must eventually be established by Electron main/native. */
  readonly source:
    | 'NATIVE_WINDOWS_JOB_OWNER'
    | 'ELECTRON_APP_INSTANCE'
    | 'ORCAD_PROFILE_LOCK'
    | 'FILESYSTEM_LOCK'
    | 'UNVERIFIED'
  /** This must cover separate Windows logon sessions, not just one app profile. */
  readonly scope: 'MACHINE' | 'USER_SESSION' | 'APP_PROFILE'
  readonly acquisition:
    | 'EXCLUSIVE_HELD_BY_SELF'
    | 'HELD_BY_OTHER'
    | 'ABANDONED'
    | 'UNKNOWN'
    | 'RELEASED'
  /** Stable canonical digest of the motor target (not app profile). */
  readonly motorIdentitySha256: string | null
  /** Generation identifier from the trusted native owner. */
  readonly generationId: string | null
  /** Windows FILETIME 100ns ticks, not a JS floating-point timestamp. */
  readonly ownerCreationTimeTicks: string | null
  readonly nativeHandleHeld: boolean
  readonly aclVerified: boolean
  readonly ownerProcessIdentityVerified: boolean
  readonly jobObjectOwnershipVerified: boolean
  readonly censusAfterAcquire:
    | 'NO_LISTENER_AND_NO_OWNER'
    | 'FOREIGN_INSTANCE'
    | 'OWNED_INSTANCE'
    | 'UNKNOWN'
}

export type MotorLeaseBlockCode =
  | 'WINDOWS_ONLY'
  | 'STAGING_ONLY'
  | 'TRUSTED_NATIVE_OWNER_REQUIRED'
  | 'MACHINE_SCOPE_REQUIRED'
  | 'ANOTHER_OWNER'
  | 'ABANDONED_REQUIRES_RECONCILIATION'
  | 'OWNERSHIP_UNVERIFIED'
  | 'MOTOR_IDENTITY_UNVERIFIED'
  | 'GENERATION_UNVERIFIED'
  | 'CREATION_TIME_UNVERIFIED'
  | 'HANDLE_NOT_HELD'
  | 'ACL_UNVERIFIED'
  | 'OWNER_IDENTITY_UNVERIFIED'
  | 'JOB_OWNERSHIP_UNVERIFIED'
  | 'FOREIGN_LISTENER_PRESENT'
  | 'OLD_MOTOR_STILL_PRESENT'
  | 'POST_LOCK_CENSUS_UNVERIFIED'

export type MotorLeaseQualification =
  | { readonly state: 'BLOCKED'; readonly code: MotorLeaseBlockCode }
  | { readonly state: 'READY_FOR_ISOLATED_NATIVE_QA'; readonly code: null }

const HEX_SHA256 = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FILETIME = /^[1-9][0-9]{11,19}$/

/**
 * A successful decision ONLY says that the proposed native proof has the
 * right shape and declared invariants for *further isolated QA*. A JS caller
 * can forge these fields, so this verdict is NEVER an operational grant.
 */
export function evaluateMotorLeaseQualification(
  evidence: MotorLeaseEvidence
): MotorLeaseQualification {
  const block = (code: MotorLeaseBlockCode): MotorLeaseQualification =>
    ({ state: 'BLOCKED', code })

  if (evidence.platform !== 'win32') return block('WINDOWS_ONLY')
  if (evidence.profile !== 'STAGING_LOCAL') return block('STAGING_ONLY')
  if (evidence.source !== 'NATIVE_WINDOWS_JOB_OWNER') {
    return block('TRUSTED_NATIVE_OWNER_REQUIRED')
  }
  if (evidence.scope !== 'MACHINE') return block('MACHINE_SCOPE_REQUIRED')
  if (evidence.acquisition === 'HELD_BY_OTHER') return block('ANOTHER_OWNER')
  if (evidence.acquisition === 'ABANDONED') {
    return block('ABANDONED_REQUIRES_RECONCILIATION')
  }
  if (evidence.acquisition !== 'EXCLUSIVE_HELD_BY_SELF') {
    return block('OWNERSHIP_UNVERIFIED')
  }
  if (!evidence.motorIdentitySha256 || !HEX_SHA256.test(evidence.motorIdentitySha256)) {
    return block('MOTOR_IDENTITY_UNVERIFIED')
  }
  if (!evidence.generationId || !UUID.test(evidence.generationId)) {
    return block('GENERATION_UNVERIFIED')
  }
  if (!evidence.ownerCreationTimeTicks ||
      !FILETIME.test(evidence.ownerCreationTimeTicks)) {
    return block('CREATION_TIME_UNVERIFIED')
  }
  if (evidence.nativeHandleHeld !== true) return block('HANDLE_NOT_HELD')
  if (evidence.aclVerified !== true) return block('ACL_UNVERIFIED')
  if (evidence.ownerProcessIdentityVerified !== true) {
    return block('OWNER_IDENTITY_UNVERIFIED')
  }
  if (evidence.jobObjectOwnershipVerified !== true) {
    return block('JOB_OWNERSHIP_UNVERIFIED')
  }
  if (evidence.censusAfterAcquire === 'FOREIGN_INSTANCE') {
    return block('FOREIGN_LISTENER_PRESENT')
  }
  if (evidence.censusAfterAcquire === 'OWNED_INSTANCE') {
    return block('OLD_MOTOR_STILL_PRESENT')
  }
  if (evidence.censusAfterAcquire !== 'NO_LISTENER_AND_NO_OWNER') {
    return block('POST_LOCK_CENSUS_UNVERIFIED')
  }

  return { state: 'READY_FOR_ISOLATED_NATIVE_QA', code: null }
}
