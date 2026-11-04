import { describe, expect, it } from 'vitest'
import {
  assessSupervisedRecoveryProvenance
} from './managed-supervised-recovery-provenance'

// C4-B1 synthetic-only: no real ports/processes/mutex, no native add-on,
// no filesystem or IPC. Claims can be forged; no positive authority exists.
const NOW = 1793791000000
const captureId = 'd0a0ca01-2345-489a-9012-abcdef123456'
const leaseGeneration = 'a0b1c2d3-2345-489a-9012-abcdef123456'
const motorIdentitySha256 = 'a'.repeat(64)
const owner = {
  generationId: captureId,
  pid: 12345,
  creationTimeTicks: '133776550123456789'
}

function claim(kind: 'lease' | 'listener' | 'process', at: number, value: string) {
  return {
    kind,
    source: 'MAIN_NATIVE_CLAIM',
    captureId,
    motorIdentitySha256,
    leaseGeneration,
    observedAtMs: at,
    value
  }
}

function good() {
  return {
    captureId,
    motorIdentitySha256,
    leaseGeneration,
    journalPhase: 'CLEAN_STOP',
    owner,
    lease: claim('lease', NOW - 1500, 'HELD_THIS_PROCESS'),
    listener: claim('listener', NOW - 1000, 'NO_LISTENER_OBSERVED'),
    process: claim('process', NOW - 500, 'NO_MATCH_OBSERVED')
  }
}

const diagnose = (data: unknown = good()) =>
  assessSupervisedRecoveryProvenance(data, NOW)

describe('Gate 9B-C4-B1 — synthetic provenance and post-lease timing never grant recovery', () => {
  it('accepts mutually consistent observations only as UNATTESTED CLAIMS and BLOCKS launch', () => {
    expect(diagnose()).toMatchObject({
      status: 'BLOCKED',
      startupAllowed: false,
      observationAuthority: 'UNATTESTED_CLAIMS_ONLY',
      consistency: 'CONSISTENT_CLAIMS_NOT_PROOF',
      diagnostic: {
        status: 'BLOCKED',
        startupAllowed: false,
        evidenceAuthentication: 'UNATTESTED',
        lease: 'HELD_THIS_PROCESS',
        listener: 'NO_LISTENER_OBSERVED',
        recordedProcess: 'NO_MATCH_OBSERVED'
      }
    })
    expect(diagnose().issues).toContain('HISTORICAL_JOURNAL_UNATTESTED')
  })

  it('blocks a missing bundle with unknown sensors', () => {
    const view = diagnose(null)
    expect(view.consistency).toBe('INCONSISTENT_OR_UNKNOWN')
    expect(view.diagnostic.lease).toBe('UNKNOWN')
    expect(view.diagnostic.recordedProcess).toBe('UNKNOWN')
    expect(view.startupAllowed).toBe(false)
  })

  it('rejects an invalid capture identity', () => {
    const view = diagnose({ ...good(), captureId: 'not-uuid' })
    expect(view.issues).toContain('CAPTURE_ID_INVALID')
    expect(view.issues).toContain('SENSOR_CAPTURE_ID_MISMATCH')
    expect(view.diagnostic.listener).toBe('UNKNOWN')
  })

  it('rejects a malformed motor digest', () => {
    const view = diagnose({ ...good(), motorIdentitySha256: 'deadbeef' })
    expect(view.issues).toContain('MOTOR_IDENTITY_INVALID')
    expect(view.diagnostic.lease).toBe('UNKNOWN')
  })

  it('rejects mismatched motor hash across otherwise identical observations', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline,
      process: { ...baseline.process, motorIdentitySha256: 'b'.repeat(64) }
    })
    expect(view.issues).toContain('SENSOR_MOTOR_IDENTITY_MISMATCH')
    expect(view.diagnostic.recordedProcess).toBe('UNKNOWN')
  })

  it('rejects missing or invalid lease generation', () => {
    const view = diagnose({ ...good(), leaseGeneration: null })
    expect(view.issues).toContain('LEASE_GENERATION_INVALID')
    expect(view.diagnostic.lease).toBe('UNKNOWN')
  })

  it('rejects process census belonging to another generation', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline,
      process: { ...baseline.process, leaseGeneration: captureId }
    })
    expect(view.issues).toContain('SENSOR_LEASE_GENERATION_MISMATCH')
    expect(view.consistency).toBe('INCONSISTENT_OR_UNKNOWN')
  })

  it('rejects a listener observation from a different capture session', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline,
      listener: { ...baseline.listener, captureId: leaseGeneration }
    })
    expect(view.issues).toContain('SENSOR_CAPTURE_ID_MISMATCH')
    expect(view.diagnostic.listener).toBe('UNKNOWN')
  })

  it('rejects a process census obtained BEFORE the lease acquisition', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline,
      process: { ...baseline.process, observedAtMs: NOW - 2000 }
    })
    expect(view.issues).toContain('SENSOR_CENSUS_PRECEDES_LEASE')
    expect(view.diagnostic.recordedProcess).toBe('UNKNOWN')
    expect(view.startupAllowed).toBe(false)
  })

  it('rejects a listener census obtained BEFORE the lease acquisition', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline,
      listener: { ...baseline.listener, observedAtMs: NOW - 2000 }
    })
    expect(view.issues).toContain('SENSOR_CENSUS_PRECEDES_LEASE')
    expect(view.diagnostic.listener).toBe('UNKNOWN')
  })

  it('does not renew a stale lease from a fresh listener', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline, lease: { ...baseline.lease, observedAtMs: NOW - 15_001 }
    })
    expect(view.issues).toContain('SENSOR_TIMESTAMP_STALE_OR_INVALID')
    expect(view.diagnostic.lease).toBe('UNKNOWN')
    expect(view.consistency).toBe('INCONSISTENT_OR_UNKNOWN')
  })

  it('rejects a future-dated census', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline, listener: { ...baseline.listener, observedAtMs: NOW + 10 }
    })
    expect(view.issues).toContain('SENSOR_TIMESTAMP_STALE_OR_INVALID')
    expect(view.diagnostic.listener).toBe('UNKNOWN')
  })

  it('rejects renderer-sourced observations even if they copy all other native-looking fields', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline, listener: { ...baseline.listener, source: 'RENDERER' }
    })
    expect(view.issues).toContain('SENSOR_SOURCE_NOT_MAIN_CLAIM')
    expect(view.diagnostic.listener).toBe('UNKNOWN')
  })

  it('rejects a historical journal claiming to be a native sensor', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline, lease: { ...baseline.lease, source: 'UNATTESTED_FILE' }
    })
    expect(view.issues).toContain('SENSOR_SOURCE_NOT_MAIN_CLAIM')
    expect(view.consistency).toBe('INCONSISTENT_OR_UNKNOWN')
  })

  it('rejects unrecognized apparent absence values', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline, process: { ...baseline.process, value: 'ALL_SAFE_AND_FREE' }
    })
    expect(view.issues).toContain('SENSOR_VALUE_UNRECOGNIZED')
    expect(view.diagnostic.recordedProcess).toBe('UNKNOWN')
  })

  it('allows reporting a listener PRESENT as a claim, while still blocking startup', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline, listener: { ...baseline.listener, value: 'PRESENT' }
    })
    expect(view.consistency).toBe('CONSISTENT_CLAIMS_NOT_PROOF')
    expect(view.diagnostic.listener).toBe('PRESENT')
    expect(view.diagnostic.startupAllowed).toBe(false)
  })

  it('allows reporting PID_REUSED as an observation, never treating it as absence', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline, process: { ...baseline.process, value: 'PID_REUSED' }
    })
    expect(view.diagnostic.recordedProcess).toBe('PID_REUSED')
    expect(view.diagnostic.reasons).toContain('PREVIOUS_PROCESS_PRESENT_OR_UNVERIFIED')
  })

  it('does not promote a CLEAN_STOP with extra invented attestation fields', () => {
    const view = diagnose({
      ...good(), attested: true, startAuthorization: true,
      journalIntegrity: 'ATTESTED',
      journalPhase: 'CLEAN_STOP'
    })
    expect(view.diagnostic.evidenceAuthentication).toBe('UNATTESTED')
    expect(view.issues).toContain('HISTORICAL_JOURNAL_UNATTESTED')
    expect(view.startupAllowed).toBe(false)
  })

  it('does not leak source process paths, environment keys or credentials', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline, authToken: 'TOP_SECRET_TOKEN',
      executable: 'C:\\private\\python.exe',
      listener: { ...baseline.listener, rawProcessPath: 'C:\\secret\\service.exe' }
    })
    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain('TOP_SECRET_TOKEN')
    expect(serialized).not.toContain('python.exe')
    expect(serialized).not.toContain('service.exe')
  })

  it('treats missing listener or process observations as UNKNOWN', () => {
    const baseline = good()
    const view = diagnose({ ...baseline, listener: null, process: null })
    expect(view.issues).toContain('SENSOR_MISSING_OR_INVALID')
    expect(view.diagnostic.listener).toBe('UNKNOWN')
    expect(view.diagnostic.recordedProcess).toBe('UNKNOWN')
  })

  it('rejects a forged sensor kind without rewriting it as a valid census', () => {
    const baseline = good()
    const view = diagnose({
      ...baseline, listener: { ...baseline.listener, kind: 'lease' }
    })
    expect(view.issues).toContain('SENSOR_MISSING_OR_INVALID')
    expect(view.diagnostic.listener).toBe('UNKNOWN')
  })

  it('is pure, deterministic and does not mutate a frozen observation bundle', () => {
    const baseline = good()
    const frozen = Object.freeze({
      ...baseline,
      owner: Object.freeze(baseline.owner),
      lease: Object.freeze(baseline.lease),
      listener: Object.freeze(baseline.listener),
      process: Object.freeze(baseline.process)
    })
    expect(diagnose(frozen)).toEqual(diagnose(frozen))
    expect(frozen.listener.kind).toBe('listener')
  })
})
