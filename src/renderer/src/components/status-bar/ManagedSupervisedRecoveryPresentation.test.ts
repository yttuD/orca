import { describe, expect, it } from 'vitest'
import {
  describeSupervisedRecoveryForRenderer
} from './ManagedSupervisedRecoveryPresentation'

function packet() {
  return {
    state: 'BLOCKED',
    startupAllowed: false,
    supervisorReviewRequired: true,
    diagnosticsOnly: true,
    currentInstance: {
      state: 'CURRENT_QA_PROCESS_ONLY',
      pid: 19999,
      creationTimeTicks: '133776550123456789',
      reason: null
    },
    previousOwner: {
      state: 'UNVERIFIED',
      reason: 'CLEAN_STOP_HISTORY_UNATTESTED'
    },
    missingEvidence: [
      'PREVIOUS_OWNER_AUTHENTICITY_NOT_ESTABLISHED',
      'PREVIOUS_JOB_OBJECT_DESCENDANTS_NOT_CENSUSED',
      'PREVIOUS_OWNER_JOURNAL_NOT_TRUSTED'
    ]
  }
}

describe('Gate 9B-C4-C-A supervised recovery renderer presentation model', () => {
  it('never authorizes startup with no packet', () => {
    const model = describeSupervisedRecoveryForRenderer(undefined)
    expect(model).toMatchObject({
      status: 'BLOCKED',
      startupAllowed: false,
      source: 'NO_QA_PACKET',
      current: 'Sin diagnóstico QA conectado'
    })
  })

  it('marks current QA information as a claim, not historical evidence', () => {
    const model = describeSupervisedRecoveryForRenderer(packet())
    expect(model.status).toBe('BLOCKED')
    expect(model.startupAllowed).toBe(false)
    expect(model.source).toBe('QA_PACKET_UNATTESTED')
    expect(model.current).toContain('QA actual')
    expect(model.previous).toContain('sin autenticación')
  })

  it('cannot trust a forged startupAllowed=true packet', () => {
    const model = describeSupervisedRecoveryForRenderer({
      ...packet(), startupAllowed: true
    })
    expect(model.source).toBe('NO_QA_PACKET')
    expect(model.startupAllowed).toBe(false)
  })

  it('cannot trust a fabricated historical ATTESTED state', () => {
    const model = describeSupervisedRecoveryForRenderer({
      ...packet(), previousOwner: {
        state: 'ATTESTED', reason: 'CLEAN_STOP_HISTORY_UNATTESTED'
      }
    })
    expect(model.source).toBe('NO_QA_PACKET')
    expect(model.previous).toBe('Sin evidencia histórica autenticada')
  })

  it('cannot elevate an unknown current process into a verified previous owner', () => {
    const model = describeSupervisedRecoveryForRenderer({
      ...packet(),
      currentInstance: { state: 'UNKNOWN', reason: 'NATIVE_LEASE_NOT_VERIFIED' }
    })
    expect(model.startupAllowed).toBe(false)
    expect(model.current).toBe('Lease nativo no verificado')
    expect(model.missing).toContain('Observación del proceso QA actual')
  })

  it('shows missing historical evidence even for an apparently healthy QA process', () => {
    const model = describeSupervisedRecoveryForRenderer(packet())
    expect(model.missing).toEqual([
      'Autoría del propietario anterior',
      'Descendientes del Job Object anterior',
      'Autenticidad del journal histórico'
    ])
  })

  it('sanitizes an unknown journal reason, not printing arbitrary untrusted text', () => {
    const model = describeSupervisedRecoveryForRenderer({
      ...packet(), previousOwner: { state: 'UNVERIFIED', reason: 'C:\\secrets\\token.json' }
    })
    expect(model.previous).toBe('Propietario histórico sin verificar')
    expect(JSON.stringify(model)).not.toContain('token.json')
  })

  it('sanitizes unknown current sensor reason instead of echoing error strings', () => {
    const model = describeSupervisedRecoveryForRenderer({
      ...packet(),
      currentInstance: { state: 'UNKNOWN', reason: 'ACCESS_TOKEN=secret' }
    })
    expect(model.current).toBe('Observación del proceso QA no verificada')
    expect(JSON.stringify(model)).not.toContain('ACCESS_TOKEN')
  })

  it('never includes PID, exact FILETIME, motor hash or raw executable path', () => {
    const p = {
      ...packet(),
      authToken: 'SUPER_SECRET',
      currentInstance: {
        ...packet().currentInstance,
        executablePath: 'C:\\private\\engine.exe'
      },
      previousOwner: {
        ...packet().previousOwner,
        hash: 'f'.repeat(64)
      }
    }
    const displayed = JSON.stringify(describeSupervisedRecoveryForRenderer(p))
    expect(displayed).not.toContain('SUPER_SECRET')
    expect(displayed).not.toContain('engine.exe')
    expect(displayed).not.toContain('133776550123456789')
    expect(displayed).not.toContain('19999')
    expect(displayed).not.toContain('f'.repeat(64))
  })

  it('does not emit user-injected missingEvidence labels', () => {
    const model = describeSupervisedRecoveryForRenderer({
      ...packet(), missingEvidence: ['RESTART_APPROVED', 'C:\\private\\secret']
    })
    expect(JSON.stringify(model)).not.toContain('RESTART_APPROVED')
    expect(JSON.stringify(model)).not.toContain('C:\\private')
    expect(model.missing).toHaveLength(3)
  })

  it('rejects a malformed scalar without crashing and remains BLOCKED', () => {
    expect(describeSupervisedRecoveryForRenderer('start now')).toMatchObject({
      status: 'BLOCKED', startupAllowed: false, source: 'NO_QA_PACKET'
    })
  })

  it('treats an unexpected current state as no packet rather than proof', () => {
    const model = describeSupervisedRecoveryForRenderer({
      ...packet(), currentInstance: {
        state: 'PREVIOUS_MOTOR_ABSENT',
        reason: null
      }
    })
    expect(model.source).toBe('NO_QA_PACKET')
    expect(model.startupAllowed).toBe(false)
  })

  it('is deterministic and never mutates an immutable packet', () => {
    const original = packet()
    Object.freeze(original.currentInstance)
    Object.freeze(original.previousOwner)
    Object.freeze(original)
    expect(describeSupervisedRecoveryForRenderer(original))
      .toEqual(describeSupervisedRecoveryForRenderer(original))
  })
})
