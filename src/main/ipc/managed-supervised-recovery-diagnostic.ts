/**
 * ORCA-D02 Gate 9B-C4-A — deterministic, side-effect-free supervised recovery
 * diagnostic projection. It accepts UNKNOWN / UNTRUSTED data and always
 * returns a BLOCKED, NO-START snapshot. It never calls a Windows API, reads
 * the host filesystem, acquires a mutex, probes a port or starts a motor.
 *
 * A caller-provided source, clock or "clean" state is NOT proof. This module
 * cannot authenticate historical owner records or claim orphan absence.
 * Never expose it as an IPC action that mutates system state.
 */
type RecordLike = Record<string, unknown>

function asRecord(value: unknown): RecordLike | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as RecordLike
}

function choice<const T extends readonly string[]>(
  value: unknown,
  accepted: T,
  fallback: 'UNKNOWN'
): T[number] | 'UNKNOWN' {
  return typeof value === 'string' && accepted.some((item) => item === value)
    ? value as T[number]
    : fallback
}

const PHASES = ['MISSING', 'CORRUPT', 'PREPARING', 'JOB_ASSIGNED', 'CLEAN_STOP', 'UNKNOWN'] as const
const LEASE_STATES = ['HELD_THIS_PROCESS', 'HELD_OTHER', 'NOT_HELD', 'UNKNOWN'] as const
const LISTENER_STATES = ['PRESENT', 'NO_LISTENER_OBSERVED', 'UNKNOWN'] as const
const PROCESS_STATES = ['OLD_PROCESS_FOUND', 'NO_MATCH_OBSERVED', 'PID_REUSED', 'UNKNOWN'] as const
const SOURCES = ['MAIN_NATIVE_CLAIM', 'UNATTESTED_FILE', 'RENDERER', 'UNKNOWN'] as const
const FILETIME = /^[1-9][0-9]{11,19}$/
const GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_OBSERVATION_AGE_MS = 15_000

export type RecoveryDiagnosticReason =
  | 'HISTORICAL_JOURNAL_MISSING'
  | 'HISTORICAL_JOURNAL_CORRUPT'
  | 'PREVIOUS_OWNER_NOT_CLEAN'
  | 'HISTORICAL_CLEAN_STOP_UNATTESTED'
  | 'JOURNAL_STATE_UNKNOWN'
  | 'OBSERVATION_STALE_OR_INVALID'
  | 'OBSERVATION_SOURCE_UNTRUSTED'
  | 'LEASE_NOT_VERIFIED'
  | 'LISTENER_PRESENT_OR_UNVERIFIED'
  | 'PREVIOUS_PROCESS_PRESENT_OR_UNVERIFIED'
  | 'OWNER_IDENTITY_UNVERIFIED'

export type SupervisedRecoveryDiagnostic = {
  readonly status: 'BLOCKED'
  readonly startupAllowed: false
  readonly reviewRequired: true
  readonly diagnosticOnly: true
  readonly evidenceAuthentication: 'UNATTESTED'
  readonly observationSource: 'MAIN_NATIVE_CLAIM' | 'UNATTESTED_FILE' | 'RENDERER' | 'UNKNOWN'
  readonly freshness: 'RECENT_CLAIM_UNATTESTED' | 'STALE_OR_INVALID'
  readonly journalPhase: typeof PHASES[number]
  readonly lease: typeof LEASE_STATES[number]
  readonly listener: typeof LISTENER_STATES[number]
  readonly recordedProcess: typeof PROCESS_STATES[number]
  readonly owner: {
    readonly generationId: string | null
    readonly pid: number | null
    readonly creationTimeTicks: string | null
  }
  readonly reasons: readonly RecoveryDiagnosticReason[]
}

function validOwner(input: unknown): SupervisedRecoveryDiagnostic['owner'] {
  const candidate = asRecord(input)
  if (!candidate) return { generationId: null, pid: null, creationTimeTicks: null }
  const validPid =
    typeof candidate.pid === 'number' && Number.isSafeInteger(candidate.pid) &&
    candidate.pid > 0 && candidate.pid <= 4294967295
  const ticks = candidate.creationTimeTicks
  // Partial identities are discarded rather than displaying a naked PID
  // that could be recycled by the operating system.
  if (!validPid || typeof ticks !== 'string' || !FILETIME.test(ticks)) {
    return { generationId: null, pid: null, creationTimeTicks: null }
  }
  return {
    generationId: typeof candidate.generationId === 'string' &&
      GENERATION.test(candidate.generationId) ? candidate.generationId : null,
    pid: candidate.pid as number,
    creationTimeTicks: ticks
  }
}

/**
 * The 15s age threshold is display-only, not a proof of observation
 * provenance or a guarantee that a process cannot start right afterwards.
 * Malformed, stale and future-dated evidence must display UNKNOWN statuses.
 */
export function projectSupervisedRecoveryDiagnostic(
  raw: unknown,
  nowMs: number
): SupervisedRecoveryDiagnostic {
  const input = asRecord(raw)
  const at = input?.observedAtMs
  const recent = Number.isFinite(nowMs) &&
    typeof at === 'number' && Number.isFinite(at) &&
    at <= nowMs && at >= 0 &&
    nowMs - at <= MAX_OBSERVATION_AGE_MS
  const source = choice(input?.source, SOURCES, 'UNKNOWN')
  // A stale observation cannot honestly represent the *current* state of
  // the port, lease or process. It does not prove absence of old owners.
  const journal = choice(input?.journalPhase, PHASES, 'UNKNOWN')
  const lease = recent ? choice(input?.lease, LEASE_STATES, 'UNKNOWN') : 'UNKNOWN'
  const listener = recent
    ? choice(input?.listener, LISTENER_STATES, 'UNKNOWN') : 'UNKNOWN'
  const processState = recent
    ? choice(input?.recordedProcess, PROCESS_STATES, 'UNKNOWN') : 'UNKNOWN'
  const owner = recent
    ? validOwner(input?.owner)
    : { generationId: null, pid: null, creationTimeTicks: null }

  const reasons: RecoveryDiagnosticReason[] = []
  if (journal === 'MISSING') reasons.push('HISTORICAL_JOURNAL_MISSING')
  else if (journal === 'CORRUPT') reasons.push('HISTORICAL_JOURNAL_CORRUPT')
  else if (journal === 'PREPARING' || journal === 'JOB_ASSIGNED') {
    reasons.push('PREVIOUS_OWNER_NOT_CLEAN')
  } else if (journal === 'CLEAN_STOP') {
    reasons.push('HISTORICAL_CLEAN_STOP_UNATTESTED')
  } else reasons.push('JOURNAL_STATE_UNKNOWN')

  if (!recent) reasons.push('OBSERVATION_STALE_OR_INVALID')
  if (source !== 'MAIN_NATIVE_CLAIM') reasons.push('OBSERVATION_SOURCE_UNTRUSTED')
  if (lease !== 'HELD_THIS_PROCESS') reasons.push('LEASE_NOT_VERIFIED')
  if (listener !== 'NO_LISTENER_OBSERVED') {
    reasons.push('LISTENER_PRESENT_OR_UNVERIFIED')
  }
  if (processState !== 'NO_MATCH_OBSERVED') {
    reasons.push('PREVIOUS_PROCESS_PRESENT_OR_UNVERIFIED')
  }
  if (owner.pid === null || owner.creationTimeTicks === null ||
      owner.generationId === null) {
    reasons.push('OWNER_IDENTITY_UNVERIFIED')
  }

  return {
    status: 'BLOCKED',
    startupAllowed: false,
    reviewRequired: true,
    diagnosticOnly: true,
    evidenceAuthentication: 'UNATTESTED',
    observationSource: source,
    freshness: recent ? 'RECENT_CLAIM_UNATTESTED' : 'STALE_OR_INVALID',
    journalPhase: journal,
    lease,
    listener,
    recordedProcess: processState,
    owner,
    reasons
  }
}
