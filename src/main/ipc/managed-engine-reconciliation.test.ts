import { describe, expect, it } from 'vitest'
import {
  evaluateMotorReconciliation,
  type MotorReconciliationEvidence,
  type ReconciliationBlockReason
} from './managed-engine-reconciliation'

// Fictional attestations: a PASS never proves a live Windows census occurred.
const perfect: MotorReconciliationEvidence = {
  platform: 'win32',
  profile: 'STAGING_LOCAL',
  identitySource: 'TRUSTED_MAIN_NATIVE',
  installationIdentityVerified: true,
  executableIdentityVerified: true,
  qaCheckoutIsolated: true,
  dataRootIsolatedAndPrivate: true,
  lease: 'NATIVE_HELD_BY_THIS_PROCESS',
  leaseIdentityMatchesEngine: true,
  leaseGenerationVerified: true,
  port: 'STAGING_EPHEMERAL',
  censusOrder: 'AFTER_LEASE',
  listener: 'NO_LISTENER',
  processTree: 'NO_OLD_OWNER',
  oldJobObjectState: 'NO_REMAINDER',
  wcbProcessesUnchanged: true
}

const denied: Array<{
  name: string
  patch: Partial<MotorReconciliationEvidence>
  reason: ReconciliationBlockReason
}> = [
  { name: 'non-Windows', patch: { platform: 'linux' }, reason: 'WINDOWS_ONLY' },
  { name: 'operational profile', patch: { profile: 'NORMAL' }, reason: 'STAGING_FIRST' },
  { name: 'renderer identity', patch: { identitySource: 'RENDERER' }, reason: 'UNTRUSTED_IDENTITY_SOURCE' },
  { name: 'environment identity', patch: { identitySource: 'ENV_ONLY' }, reason: 'UNTRUSTED_IDENTITY_SOURCE' },
  { name: 'unverified installation', patch: { installationIdentityVerified: false }, reason: 'INSTALLATION_UNVERIFIED' },
  { name: 'unverified executable', patch: { executableIdentityVerified: false }, reason: 'EXECUTABLE_UNVERIFIED' },
  { name: 'non-isolated checkout', patch: { qaCheckoutIsolated: false }, reason: 'QA_CHECKOUT_NOT_ISOLATED' },
  { name: 'shared data root', patch: { dataRootIsolatedAndPrivate: false }, reason: 'DATA_ROOT_NOT_ISOLATED' },
  { name: 'competing lease', patch: { lease: 'HELD_BY_OTHER' }, reason: 'LEASE_NOT_HELD' },
  { name: 'released lease', patch: { lease: 'RELEASED' }, reason: 'LEASE_NOT_HELD' },
  { name: 'unknown lease', patch: { lease: 'UNKNOWN' }, reason: 'LEASE_NOT_HELD' },
  { name: 'different motor identity', patch: { leaseIdentityMatchesEngine: false }, reason: 'LEASE_TARGET_MISMATCH' },
  { name: 'unverified generation', patch: { leaseGenerationVerified: false }, reason: 'LEASE_GENERATION_UNVERIFIED' },
  { name: 'operational port', patch: { port: 'RESERVED_OPERATIONAL' }, reason: 'RESERVED_OR_INVALID_PORT' },
  { name: 'invalid port', patch: { port: 'INVALID' }, reason: 'RESERVED_OR_INVALID_PORT' },
  { name: 'pre-lease census', patch: { censusOrder: 'BEFORE_LEASE' }, reason: 'CENSUS_NOT_AFTER_LEASE' },
  { name: 'unknown census ordering', patch: { censusOrder: 'UNKNOWN' }, reason: 'CENSUS_NOT_AFTER_LEASE' },
  { name: 'foreign listener', patch: { listener: 'FOREIGN_LISTENER' }, reason: 'FOREIGN_OR_EXISTING_LISTENER' },
  { name: 'same-motor listener', patch: { listener: 'KNOWN_OWN_LISTENER' }, reason: 'FOREIGN_OR_EXISTING_LISTENER' },
  { name: 'unknown listener', patch: { listener: 'UNKNOWN' }, reason: 'LISTENER_UNKNOWN' },
  { name: 'orphan owned tree', patch: { processTree: 'OLD_OWNED_TREE' }, reason: 'OLD_OR_FOREIGN_PROCESS_TREE' },
  { name: 'foreign process tree', patch: { processTree: 'FOREIGN_TREE' }, reason: 'OLD_OR_FOREIGN_PROCESS_TREE' },
  { name: 'unproven process tree', patch: { processTree: 'UNKNOWN' }, reason: 'PROCESS_TREE_UNKNOWN' },
  { name: 'job descendants alive', patch: { oldJobObjectState: 'ACTIVE_DESCENDANTS' }, reason: 'OLD_JOB_OBJECT_STILL_ACTIVE' },
  { name: 'unknown job state', patch: { oldJobObjectState: 'UNKNOWN' }, reason: 'JOB_OBJECT_STATE_UNKNOWN' },
  { name: 'WCB preservation unverified', patch: { wcbProcessesUnchanged: false }, reason: 'WCB_ISOLATION_UNVERIFIED' }
]

describe('Gate 9B-C3 pure staging-only reconciliation decisions', () => {
  it('only produces a QA eligibility marker for an ideal synthetic assertion set', () => {
    expect(evaluateMotorReconciliation(perfect)).toEqual({
      state: 'READY_FOR_DISPOSABLE_STAGING_QA', reason: null
    })
  })

  it.each(denied)('blocks $name', ({ patch, reason }) => {
    expect(evaluateMotorReconciliation({ ...perfect, ...patch })).toEqual({
      state: 'BLOCKED', reason
    })
  })

  it('is deterministic and does not mutate inputs or start services', () => {
    const immutable = Object.freeze({ ...perfect })
    expect(evaluateMotorReconciliation(immutable)).toEqual(
      evaluateMotorReconciliation(immutable)
    )
    expect(immutable.port).toBe('STAGING_EPHEMERAL')
  })
})
