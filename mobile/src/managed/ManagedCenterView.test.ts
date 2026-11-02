import { describe, it, expect } from 'vitest'
import { SYNTHETIC_MANAGED_PROJECTS, SYNTHETIC_MANAGED_EVIDENCE } from './fixtures'

describe('ManagedCenterView & Mobile Fixture Integrity', () => {
  it('1. contains registered synthetic projects with proper schemas', () => {
    expect(SYNTHETIC_MANAGED_PROJECTS.length).toBeGreaterThanOrEqual(2)
    const p1 = SYNTHETIC_MANAGED_PROJECTS[0]
    expect(p1.id).toBe('c0a80101-0000-4000-8000-000000000001')
    expect(p1.name).toBe('Chat-AGY-CODEX-Orquestador')
    expect(p1.mode).toBe('MANAGED')
  })

  it('2. certifies authentic task only when all checks pass and provenance is verified', () => {
    const authEv = SYNTHETIC_MANAGED_EVIDENCE['TASK-F-CHAT-02-AUTHENTIC']
    expect(authEv).toBeDefined()
    expect(authEv.provenance).toBe('AUTHENTIC')
    expect(authEv.provenance_verified).toBe(true)
    expect(authEv.commit_exists).toBe(true)
    expect(authEv.hash_status).toBe('VERIFIED')
    expect(authEv.hash_verified).toBe(true)
    expect(authEv.checks_summary.failed).toBe(0)
    expect(authEv.checks.length).toBe(3)
    expect(authEv.checks.every((c) => c.status === 'PASS')).toBe(true)
    expect(authEv.certification_status).toBe('CERTIFIED')
    expect(authEv.memory_telemetry.status).toBe('MEASURED')
  })

  it('3. rejects certification when checks fail and provenance is unverified', () => {
    const failEv = SYNTHETIC_MANAGED_EVIDENCE['TASK-F-CHAT-01-SYNTHETIC']
    expect(failEv).toBeDefined()
    expect(failEv.provenance).toBe('UNVERIFIED')
    expect(failEv.provenance_verified).toBe(false)
    expect(failEv.hash_status).toBe('MISMATCH')
    expect(failEv.hash_verified).toBe(false)
    expect(failEv.checks_summary.failed).toBe(1)
    expect(failEv.certification_status).toBe('REJECTED')
  })

  it('4. marks uncertified when task has zero checks executed', () => {
    const zeroEv = SYNTHETIC_MANAGED_EVIDENCE['TASK-F-CHAT-03-ZERO-CHECKS']
    expect(zeroEv).toBeDefined()
    expect(zeroEv.checks.length).toBe(0)
    expect(zeroEv.checks_summary.total).toBe(0)
    expect(zeroEv.certification_status).toBe('UNCERTIFIED')
    expect(zeroEv.memory_telemetry.status).toBe('NOT_MEASURED')
  })
})
