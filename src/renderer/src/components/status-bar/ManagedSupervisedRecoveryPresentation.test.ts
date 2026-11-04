import { describe, expect, it } from 'vitest'
import {
  describeSupervisedRecoveryForRenderer,
  describeQaLifecycleForRenderer
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


describe('Gate 9B-C4-C-B existing Electron QA lifecycle projection', () => {
  it('fails closed without a lifecycle from Electron Main', () => {
    expect(describeQaLifecycleForRenderer(undefined)).toEqual({
      state: 'NO_QA_SNAPSHOT',
      label: 'Sin estado QA confiable de la sesión actual',
      authority: 'UNATTESTED_LIFECYCLE_ONLY',
      startupAllowed: false
    })
  })

  it('reports a declared ONLINE QA lifecycle without granting launch', () => {
    expect(describeQaLifecycleForRenderer({
      phase: 'ONLINE', owner: 'THIS_ELECTRON', port: 55001, restarts: 0
    })).toMatchObject({
      state: 'QA_LIFECYCLE_CLAIM_ONLY',
      label: 'Ciclo QA de Electron: En línea · proceso declarado propio',
      authority: 'UNATTESTED_LIFECYCLE_ONLY',
      startupAllowed: false
    })
  })

  it('describes a stopped QA lifecycle as a declaration rather than absence of previous motors', () => {
    const result = describeQaLifecycleForRenderer({ phase: 'STOPPED', owner: 'NONE' })
    expect(result.label).toContain('Detenido')
    expect(result.label).toContain('sin proceso declarado')
    expect(result.startupAllowed).toBe(false)
    expect(JSON.stringify(result)).not.toContain('NO_PREVIOUS_MOTOR')
  })

  it('rejects impossible ONLINE lifecycle without an Electron-owned child', () => {
    expect(describeQaLifecycleForRenderer({
      phase: 'ONLINE', owner: 'NONE'
    }).state).toBe('NO_QA_SNAPSHOT')
  })

  it('rejects a phase invented by an untrusted renderer', () => {
    expect(describeQaLifecycleForRenderer({
      phase: 'READY_TO_RESTART', owner: 'THIS_ELECTRON'
    }).state).toBe('NO_QA_SNAPSHOT')
  })

  it('rejects an owner string outside the trusted status enumeration', () => {
    expect(describeQaLifecycleForRenderer({
      phase: 'STOPPED', owner: 'TRUSTED_HISTORICAL_OWNER'
    }).state).toBe('NO_QA_SNAPSHOT')
  })

  it('does not turn the disabled lifecycle into a current-owner observation', () => {
    expect(describeQaLifecycleForRenderer({
      phase: 'DISABLED', owner: 'NONE'
    })).toMatchObject({
      state: 'NO_QA_SNAPSHOT',
      startupAllowed: false
    })
  })

  it('never displays raw error_code, executable paths, tokens or ports', () => {
    const report = describeQaLifecycleForRenderer({
      phase: 'ERROR',
      owner: 'NONE',
      error_code: 'C:\\secret\\credentials.txt',
      executablePath: 'C:\\private\\python.exe',
      port: 8765,
      authToken: 'AUTH_SECRET_123',
      startupAllowed: true
    })
    const serialized = JSON.stringify(report)
    expect(report.startupAllowed).toBe(false)
    for(const secret of ['credentials.txt', 'python.exe', '8765', 'AUTH_SECRET_123']){
      expect(serialized).not.toContain(secret)
    }
  })

  it('does not call a QA recovery loop a validated historical recovery', () => {
    const view = describeQaLifecycleForRenderer({
      phase: 'RECOVERING', owner: 'THIS_ELECTRON', restarts: 10
    })
    expect(view.label).toContain('En transición de prueba')
    expect(view.authority).toBe('UNATTESTED_LIFECYCLE_ONLY')
    expect(view.startupAllowed).toBe(false)
  })

  it('is pure and deterministic with frozen caller inputs', () => {
    const raw = Object.freeze({
      phase: 'DEGRADED',
      owner: 'THIS_ELECTRON',
      error_code: 'QA_ONLY'
    })
    expect(describeQaLifecycleForRenderer(raw))
      .toEqual(describeQaLifecycleForRenderer(raw))
  })
})
