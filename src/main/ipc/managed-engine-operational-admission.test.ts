import { describe, expect, it } from 'vitest'
import {
  evaluateOperationalEngineAdmission,
  type EngineAdmissionEvidence,
  type EngineAdmissionBlockReason
} from './managed-engine-operational-admission'

const qualificationOnly: EngineAdmissionEvidence = {
  platform: 'win32',
  profile: 'STAGING_LOCAL',
  nativeApprovalVerified: true,
  executableAndInstallTrusted: true,
  dedicatedDataRootVerified: true,
  orphanAndPortCensus: 'NO_LISTENER_AND_NO_OWNER',
  exclusiveStartupLeaseHeld: true,
  suspendedSpawnAvailable: true,
  nativeJobObjectAvailable: true,
  jobKillOnLastHandleClose: true,
  descendantsContainedByJob: true,
  processIdentityWithCreationTime: true,
  wcbAndExistingProcessesIsolated: true,
  rollbackAndCrashRecoveryValidated: true
}

describe('Gate 9B fail-closed operational motor admission contract', () => {
  it('never authorizes launching an operational motor, even with hypothetical perfect evidence', () => {
    expect(evaluateOperationalEngineAdmission(qualificationOnly)).toEqual({
      state: 'READY_FOR_WINDOWS_QUALIFICATION',
      reason: null
    })
  })

  const booleanRejections: Array<
    [keyof EngineAdmissionEvidence, EngineAdmissionBlockReason]
  > = [
    ['nativeApprovalVerified', 'NATIVE_OPERATOR_APPROVAL_REQUIRED'],
    ['executableAndInstallTrusted', 'UNTRUSTED_INSTALL'],
    ['dedicatedDataRootVerified', 'DATA_ISOLATION_UNVERIFIED'],
    ['exclusiveStartupLeaseHeld', 'EXCLUSIVE_LEASE_REQUIRED'],
    ['suspendedSpawnAvailable', 'SUSPENDED_SPAWN_UNAVAILABLE'],
    ['nativeJobObjectAvailable', 'WIN32_JOB_OBJECT_UNAVAILABLE'],
    ['jobKillOnLastHandleClose', 'JOB_KILL_ON_CLOSE_UNVERIFIED'],
    ['descendantsContainedByJob', 'DESCENDANT_CONTAINMENT_UNVERIFIED'],
    ['processIdentityWithCreationTime', 'PROCESS_CREATION_IDENTITY_UNVERIFIED'],
    ['wcbAndExistingProcessesIsolated', 'WCB_ISOLATION_UNVERIFIED'],
    ['rollbackAndCrashRecoveryValidated', 'CRASH_RECOVERY_UNVERIFIED']
  ]

  it.each(booleanRejections)('fails closed if %s is not independently proven', (key, reason) => {
    const incomplete = { ...qualificationOnly, [key]: false }
    expect(evaluateOperationalEngineAdmission(incomplete)).toEqual({
      state: 'BLOCKED',
      reason
    })
  })

  it('rejects NORMAL until staging isolation is qualified', () => {
    expect(evaluateOperationalEngineAdmission({
      ...qualificationOnly, profile: 'NORMAL'
    })).toMatchObject({ state: 'BLOCKED', reason: 'STAGING_FIRST' })
  })

  it('rejects Linux despite a complete claimed evidence packet', () => {
    expect(evaluateOperationalEngineAdmission({
      ...qualificationOnly, platform: 'linux'
    })).toMatchObject({ state: 'BLOCKED', reason: 'WINDOWS_ONLY' })
  })

  it.each([
    ['FOREIGN_INSTANCE', 'FOREIGN_INSTANCE_PRESENT'],
    ['OWNED_INSTANCE', 'INCUMBENT_OWNERSHIP_UNVERIFIED'],
    ['UNVERIFIED', 'INCUMBENT_OWNERSHIP_UNVERIFIED']
  ] as const)('does not adopt or replace preexisting listener %s', (census, reason) => {
    expect(evaluateOperationalEngineAdmission({
      ...qualificationOnly,
      orphanAndPortCensus: census
    })).toEqual({ state: 'BLOCKED', reason })
  })

  it('does not execute or enumerate processes: it is a pure synchronous decision', () => {
    const input = Object.freeze({ ...qualificationOnly })
    const first = evaluateOperationalEngineAdmission(input)
    const second = evaluateOperationalEngineAdmission(input)
    expect(first).toEqual(second)
    expect(input.orphanAndPortCensus).toBe('NO_LISTENER_AND_NO_OWNER')
  })
})
