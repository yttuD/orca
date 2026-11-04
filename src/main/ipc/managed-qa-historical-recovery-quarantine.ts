/**
 * ORCA-D02 Gate 9B-C3-E-E — historic QA-journal trust boundary.
 *
 * Every saved C3-E journal is SYNTHETIC and UNATTESTED, even when:
 * - JSON schema and SHA-256 digest validate,
 * - it says CLEAN_STOP and contains zero Job Object members,
 * - a prior in-process native lease+job check legitimately wrote it.
 *
 * Filesystem bytes cannot prove their author after owner death. Neither
 * this guard nor any caller can turn such bytes into an ATTESTED journal,
 * or use them to authorize another FastAPI motor, bind, or process adoption.
 */
import {
  readQaPreviousOwnerJournal
} from './managed-previous-owner-journal-qa'

export type QaHistoricalQuarantineReason =
  | 'HISTORICAL_JOURNAL_MISSING'
  | 'HISTORICAL_JOURNAL_UNVERIFIABLE'
  | 'PREVIOUS_OWNER_INTERRUPTED_OR_UNVERIFIED'
  | 'CLEAN_STOP_HISTORY_UNATTESTED'

export type QaHistoricalQuarantine = {
  readonly state: 'BLOCKED'
  readonly reason: QaHistoricalQuarantineReason
  /** Never promote a digest or user-controlled field to trusted authority. */
  readonly journalIntegrity: 'UNVERIFIED'
  readonly startupAllowed: false
}

/**
 * Read-only QA classification. This is NOT a policy with an allow path.
 * Future operational recovery needs an independent, trusted native proof
 * with anti-rollback guarantees, not simply more checks on the same file.
 */
export function quarantineQaHistoricalJournal(root: string): QaHistoricalQuarantine {
  const observation = readQaPreviousOwnerJournal(root)
  if (observation.state === 'MISSING') {
    return {
      state: 'BLOCKED',
      reason: 'HISTORICAL_JOURNAL_MISSING',
      journalIntegrity: 'UNVERIFIED',
      startupAllowed: false
    }
  }
  if (observation.state === 'CORRUPT_OR_UNREADABLE') {
    return {
      state: 'BLOCKED',
      reason: 'HISTORICAL_JOURNAL_UNVERIFIABLE',
      journalIntegrity: 'UNVERIFIED',
      startupAllowed: false
    }
  }
  return {
    state: 'BLOCKED',
    reason: observation.record.phase === 'CLEAN_STOP'
      ? 'CLEAN_STOP_HISTORY_UNATTESTED'
      : 'PREVIOUS_OWNER_INTERRUPTED_OR_UNVERIFIED',
    journalIntegrity: 'UNVERIFIED',
    startupAllowed: false
  }
}
