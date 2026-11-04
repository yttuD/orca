import { describe, expect, it } from 'vitest'
import {
  evaluateMotorLeaseQualification,
  type MotorLeaseEvidence,
  type MotorLeaseBlockCode
} from './managed-engine-lease-qualification'

/** Synthetic declarations only. None of these is native proof or a launch grant. */
const candidate: MotorLeaseEvidence = {
  platform: 'win32',
  profile: 'STAGING_LOCAL',
  source: 'NATIVE_WINDOWS_JOB_OWNER',
  scope: 'MACHINE',
  acquisition: 'EXCLUSIVE_HELD_BY_SELF',
  motorIdentitySha256: 'a'.repeat(64),
  generationId: 'd0a0ca01-2345-489a-9012-abcdef123456',
  ownerCreationTimeTicks: '133776550123456789',
  nativeHandleHeld: true,
  aclVerified: true,
  ownerProcessIdentityVerified: true,
  jobObjectOwnershipVerified: true,
  censusAfterAcquire: 'NO_LISTENER_AND_NO_OWNER'
}

describe('Gate 9B-C2 — pure fail-closed motor ownership lease contract', () => {
  it('qualifies an entirely synthetic ideal proof for further QA ONLY', () => {
    expect(evaluateMotorLeaseQualification(candidate)).toEqual({
      state: 'READY_FOR_ISOLATED_NATIVE_QA',
      code: null
    })
  })

  const rejects: ReadonlyArray<{
    label: string
    patch: Partial<MotorLeaseEvidence>
    code: MotorLeaseBlockCode
  }> = [
    {
      label: 'non-Windows host', patch: { platform: 'linux' },
      code: 'WINDOWS_ONLY'
    },
    {
      label: 'production profile', patch: { profile: 'NORMAL' },
      code: 'STAGING_ONLY'
    },
    {
      label: 'Electron app lock', patch: { source: 'ELECTRON_APP_INSTANCE' },
      code: 'TRUSTED_NATIVE_OWNER_REQUIRED'
    },
    {
      label: 'existing orcad profile lock', patch: { source: 'ORCAD_PROFILE_LOCK' },
      code: 'TRUSTED_NATIVE_OWNER_REQUIRED'
    },
    {
      label: 'filesystem lock', patch: { source: 'FILESYSTEM_LOCK' },
      code: 'TRUSTED_NATIVE_OWNER_REQUIRED'
    },
    {
      label: 'session-only scope', patch: { scope: 'USER_SESSION' },
      code: 'MACHINE_SCOPE_REQUIRED'
    },
    {
      label: 'profile-only scope', patch: { scope: 'APP_PROFILE' },
      code: 'MACHINE_SCOPE_REQUIRED'
    },
    {
      label: 'competing owner', patch: { acquisition: 'HELD_BY_OTHER' },
      code: 'ANOTHER_OWNER'
    },
    {
      label: 'abandoned native ownership', patch: { acquisition: 'ABANDONED' },
      code: 'ABANDONED_REQUIRES_RECONCILIATION'
    },
    {
      label: 'unknown ownership', patch: { acquisition: 'UNKNOWN' },
      code: 'OWNERSHIP_UNVERIFIED'
    },
    {
      label: 'already released', patch: { acquisition: 'RELEASED' },
      code: 'OWNERSHIP_UNVERIFIED'
    },
    {
      label: 'absent motor identity', patch: { motorIdentitySha256: null },
      code: 'MOTOR_IDENTITY_UNVERIFIED'
    },
    {
      label: 'invalid motor identity hash', patch: { motorIdentitySha256: 'x'.repeat(64) },
      code: 'MOTOR_IDENTITY_UNVERIFIED'
    },
    {
      label: 'missing lease generation', patch: { generationId: null },
      code: 'GENERATION_UNVERIFIED'
    },
    {
      label: 'malformed lease generation', patch: { generationId: '123' },
      code: 'GENERATION_UNVERIFIED'
    },
    {
      label: 'missing Windows creation time', patch: { ownerCreationTimeTicks: null },
      code: 'CREATION_TIME_UNVERIFIED'
    },
    {
      label: 'nondecimal Windows creation time', patch: { ownerCreationTimeTicks: '1e17' },
      code: 'CREATION_TIME_UNVERIFIED'
    },
    {
      label: 'lost native lease handle', patch: { nativeHandleHeld: false },
      code: 'HANDLE_NOT_HELD'
    },
    {
      label: 'unverified namespace ACL', patch: { aclVerified: false },
      code: 'ACL_UNVERIFIED'
    },
    {
      label: 'unproven owner process identity', patch: { ownerProcessIdentityVerified: false },
      code: 'OWNER_IDENTITY_UNVERIFIED'
    },
    {
      label: 'job object not bound to owner', patch: { jobObjectOwnershipVerified: false },
      code: 'JOB_OWNERSHIP_UNVERIFIED'
    },
    {
      label: 'foreign listening service', patch: { censusAfterAcquire: 'FOREIGN_INSTANCE' },
      code: 'FOREIGN_LISTENER_PRESENT'
    },
    {
      label: 'old owned process still exists', patch: { censusAfterAcquire: 'OWNED_INSTANCE' },
      code: 'OLD_MOTOR_STILL_PRESENT'
    },
    {
      label: 'unverifiable post-acquire census', patch: { censusAfterAcquire: 'UNKNOWN' },
      code: 'POST_LOCK_CENSUS_UNVERIFIED'
    }
  ]

  it.each(rejects)('blocks $label', ({ patch, code }) => {
    expect(evaluateMotorLeaseQualification({ ...candidate, ...patch })).toEqual({
      state: 'BLOCKED',
      code
    })
  })

  it('does not mutate the input and makes no native or filesystem calls', () => {
    const frozen = Object.freeze({ ...candidate })
    expect(evaluateMotorLeaseQualification(frozen)).toEqual(
      evaluateMotorLeaseQualification(frozen)
    )
    expect(frozen.acquisition).toBe('EXCLUSIVE_HELD_BY_SELF')
  })
})
