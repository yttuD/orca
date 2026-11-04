/**
 * ORCA-D02 Gate 9B-C4-B1 — pure, synthetic observation provenance/ordering
 * consistency for the SUPERVISED recovery diagnostic.
 *
 * No filesystem, kernel, port, PID scanning or IPC; these are *claims*,
 * not proof of originating from Electron main/native.
 *
 * The output is ALWAYS blocked. A consistent collection of forged claims
 * MUST remain UNATTESTED and cannot authorize launch/recovery.
 */
import {
  projectSupervisedRecoveryDiagnostic,
  type SupervisedRecoveryDiagnostic
} from './managed-supervised-recovery-diagnostic'

type JsonObject = Record<string, unknown>
function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject : null
}

const HEX256 = /^[a-f0-9]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_AGE_MS = 15_000
const SOURCES = ['MAIN_NATIVE_CLAIM', 'UNATTESTED_FILE', 'RENDERER', 'UNKNOWN'] as const
type Source = typeof SOURCES[number]
type Kind = 'lease' | 'listener' | 'process'
const KINDS: readonly Kind[] = ['lease', 'listener', 'process']
type SensorValue = string

export type RecoveryClaimIssue =
  | 'CAPTURE_ID_INVALID'
  | 'MOTOR_IDENTITY_INVALID'
  | 'LEASE_GENERATION_INVALID'
  | 'SENSOR_MISSING_OR_INVALID'
  | 'SENSOR_SOURCE_NOT_MAIN_CLAIM'
  | 'SENSOR_CAPTURE_ID_MISMATCH'
  | 'SENSOR_MOTOR_IDENTITY_MISMATCH'
  | 'SENSOR_LEASE_GENERATION_MISMATCH'
  | 'SENSOR_TIMESTAMP_STALE_OR_INVALID'
  | 'SENSOR_CENSUS_PRECEDES_LEASE'
  | 'SENSOR_VALUE_UNRECOGNIZED'
  | 'HISTORICAL_JOURNAL_UNATTESTED'

export type SupervisedRecoveryProvenanceReport = {
  readonly status: 'BLOCKED'
  readonly startupAllowed: false
  readonly observationAuthority: 'UNATTESTED_CLAIMS_ONLY'
  readonly consistency: 'CONSISTENT_CLAIMS_NOT_PROOF' | 'INCONSISTENT_OR_UNKNOWN'
  readonly issues: readonly RecoveryClaimIssue[]
  readonly diagnostic: SupervisedRecoveryDiagnostic
}

/**
 * Input is a synthetic/read-only bundle:
 * { captureId, motorIdentitySha256, leaseGeneration, journalPhase, owner,
 *   lease:{kind,source,captureId,motorIdentitySha256,leaseGeneration,
 *     observedAtMs,value}, listener:{...}, process:{...} }.
 * Values are NOT authenticated. Caller fields are NEVER exposed verbatim.
 */
export function assessSupervisedRecoveryProvenance(
  raw: unknown,
  nowMs: number
): SupervisedRecoveryProvenanceReport {
  const root = object(raw)
  const id = root?.captureId
  const motor = root?.motorIdentitySha256
  const generation = root?.leaseGeneration
  const validId = typeof id === 'string' && UUID.test(id)
  const validMotor = typeof motor === 'string' && HEX256.test(motor)
  const validGeneration = typeof generation === 'string' && UUID.test(generation)
  const issues: RecoveryClaimIssue[] = []

  if (!validId) issues.push('CAPTURE_ID_INVALID')
  if (!validMotor) issues.push('MOTOR_IDENTITY_INVALID')
  if (!validGeneration) issues.push('LEASE_GENERATION_INVALID')

  const decoded: Record<Kind, {
    valid: boolean
    at: number | null
    value: SensorValue
    source: Source
  }> = {
    lease: { valid: false, at: null, value: 'UNKNOWN', source: 'UNKNOWN' },
    listener: { valid: false, at: null, value: 'UNKNOWN', source: 'UNKNOWN' },
    process: { valid: false, at: null, value: 'UNKNOWN', source: 'UNKNOWN' }
  }

  for (const kind of KINDS) {
    const claim = object(root?.[kind])
    if (!claim || claim.kind !== kind) {
      issues.push('SENSOR_MISSING_OR_INVALID')
      continue
    }
    const source = SOURCES.find((item) => item === claim.source) ?? 'UNKNOWN'
    if (source !== 'MAIN_NATIVE_CLAIM') issues.push('SENSOR_SOURCE_NOT_MAIN_CLAIM')

    const captureOk = validId && claim.captureId === id
    const motorOk = validMotor && claim.motorIdentitySha256 === motor
    const leaseGenOk = validGeneration && claim.leaseGeneration === generation
    if (!captureOk) issues.push('SENSOR_CAPTURE_ID_MISMATCH')
    if (!motorOk) issues.push('SENSOR_MOTOR_IDENTITY_MISMATCH')
    if (!leaseGenOk) issues.push('SENSOR_LEASE_GENERATION_MISMATCH')

    const at = claim.observedAtMs
    const timeOk = typeof at === 'number' && Number.isFinite(at) &&
      Number.isFinite(nowMs) && at >= 0 && at <= nowMs &&
      nowMs - at <= MAX_AGE_MS
    if (!timeOk) issues.push('SENSOR_TIMESTAMP_STALE_OR_INVALID')

    const validValue = kind === 'lease'
      ? claim.value === 'HELD_THIS_PROCESS'
      : kind === 'listener'
        ? claim.value === 'NO_LISTENER_OBSERVED' || claim.value === 'PRESENT'
        : claim.value === 'NO_MATCH_OBSERVED' ||
          claim.value === 'OLD_PROCESS_FOUND' || claim.value === 'PID_REUSED'
    if (!validValue) issues.push('SENSOR_VALUE_UNRECOGNIZED')

    decoded[kind] = {
      valid: source === 'MAIN_NATIVE_CLAIM' && captureOk && motorOk &&
        leaseGenOk && timeOk && validValue,
      at: timeOk ? at as number : null,
      value: validValue ? claim.value as string : 'UNKNOWN',
      source
    }
  }

  const leaseAt = decoded.lease.at
  for (const kind of ['listener', 'process'] as const) {
    const sampleAt = decoded[kind].at
    if (leaseAt === null || sampleAt === null || sampleAt < leaseAt) {
      issues.push('SENSOR_CENSUS_PRECEDES_LEASE')
      decoded[kind].valid = false
    }
  }

  // A historical journal is *always* untrusted, regardless of its hash,
  // origin label, phase and apparent signatures in the supplied JSON.
  issues.push('HISTORICAL_JOURNAL_UNATTESTED')

  const allConsistent = validId && validMotor && validGeneration &&
    KINDS.every((kind) => decoded[kind].valid)

  // C4-A itself independently maps stale/untrusted statuses to UNKNOWN,
  // and never produces a start grant even if everything here is consistent.
  // The observation time is the OLDEST accepted sample: a fresh listener
  // cannot renew an old lease or older process observation.
  const at = allConsistent
    ? Math.min(...KINDS.map((kind) => decoded[kind].at as number))
    : Number.NaN

  const diagnostic = projectSupervisedRecoveryDiagnostic({
    source: allConsistent ? 'MAIN_NATIVE_CLAIM' : 'UNKNOWN',
    observedAtMs: at,
    journalPhase: root?.journalPhase,
    lease: allConsistent ? decoded.lease.value : 'UNKNOWN',
    listener: allConsistent ? decoded.listener.value : 'UNKNOWN',
    recordedProcess: allConsistent ? decoded.process.value : 'UNKNOWN',
    owner: allConsistent ? root?.owner : null
  }, nowMs)

  return {
    status: 'BLOCKED',
    startupAllowed: false,
    observationAuthority: 'UNATTESTED_CLAIMS_ONLY',
    consistency: allConsistent
      ? 'CONSISTENT_CLAIMS_NOT_PROOF' : 'INCONSISTENT_OR_UNKNOWN',
    issues: [...new Set(issues)],
    diagnostic
  }
}
