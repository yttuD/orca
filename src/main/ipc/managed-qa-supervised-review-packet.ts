/**
 * ORCA-D02 Gate 9B-C4-B2-B — assemble a safe review packet in QA only.
 *
 * Live evidence covers ONLY the current test process, never a prior motor.
 * Historic C3-E journal bytes are deliberately UNATTESTED, even when the
 * hash is valid and phase is CLEAN_STOP. No positive recovery decision.
 *
 * Not exported through IPC/preload or renderer. No motor or network
 * actions. The journal reader does not change record payloads, but its
 * QA-root preflight may RESTRICT the disposable directory's Windows ACL;
 * this is not a completely side-effect-free filesystem operation.
 * The native self-observation uses only an existing owned server/mutex.
 */
import type { Server } from 'node:net'
import type { ManagedMotorLeaseHandle } from '../../../native/windows-security'
import {
  inspectCurrentQaProcessUnderNativeLease,
  type QaNativeSelfObservationReason
} from './managed-qa-native-self-observation'
import {
  quarantineQaHistoricalJournal,
  type QaHistoricalQuarantineReason
} from './managed-qa-historical-recovery-quarantine'

export type QaSupervisedReviewPacket = {
  readonly state: 'BLOCKED'
  readonly startupAllowed: false
  readonly supervisorReviewRequired: true
  readonly diagnosticsOnly: true
  readonly currentInstance: {
    readonly state: 'CURRENT_QA_PROCESS_ONLY' | 'UNKNOWN'
    readonly pid: number | null
    readonly creationTimeTicks: string | null
    readonly reason: QaNativeSelfObservationReason | null
  }
  readonly previousOwner: {
    readonly state: 'UNVERIFIED'
    readonly reason: QaHistoricalQuarantineReason | 'JOURNAL_READER_REJECTED'
  }
  readonly missingEvidence: readonly (
    | 'PREVIOUS_OWNER_AUTHENTICITY_NOT_ESTABLISHED'
    | 'PREVIOUS_JOB_OBJECT_DESCENDANTS_NOT_CENSUSED'
    | 'PREVIOUS_OWNER_JOURNAL_NOT_TRUSTED'
    | 'CURRENT_QA_OBSERVATION_UNKNOWN'
  )[]
}

/**
 * The only supported call site for now is the isolated Windows QA fixture.
 * Do not accept this DTO as an IPC start grant or use it for auto-recovery.
 */
export function buildQaSupervisedReviewPacket(
  lease: ManagedMotorLeaseHandle,
  motorIdentitySha256: string,
  generationId: string,
  ownServer: Server,
  disposableJournalRoot: string
): QaSupervisedReviewPacket {
  const live = inspectCurrentQaProcessUnderNativeLease(
    lease, motorIdentitySha256, generationId, ownServer
  )

  // If the journal directory, ACL, environment opt-in or schema cannot be
  // verified, do not fall back to MISSING, CLEAN_STOP or an empty QA root.
  let historicalReason: QaSupervisedReviewPacket['previousOwner']['reason']
  try {
    const result = quarantineQaHistoricalJournal(disposableJournalRoot)
    historicalReason = result.reason
  } catch {
    historicalReason = 'JOURNAL_READER_REJECTED'
  }

  const liveReady = live.observationKind === 'CURRENT_QA_PROCESS_ONLY'
  return {
    state: 'BLOCKED',
    startupAllowed: false,
    supervisorReviewRequired: true,
    diagnosticsOnly: true,
    currentInstance: {
      state: live.observationKind,
      pid: liveReady ? live.owner.pid : null,
      creationTimeTicks: liveReady ? live.owner.creationTimeTicks : null,
      reason: liveReady ? null : live.reason
    },
    previousOwner: {
      state: 'UNVERIFIED',
      reason: historicalReason
    },
    missingEvidence: [
      'PREVIOUS_OWNER_AUTHENTICITY_NOT_ESTABLISHED',
      'PREVIOUS_JOB_OBJECT_DESCENDANTS_NOT_CENSUSED',
      'PREVIOUS_OWNER_JOURNAL_NOT_TRUSTED',
      ...(!liveReady ? ['CURRENT_QA_OBSERVATION_UNKNOWN'] as const : [])
    ]
  }
}
