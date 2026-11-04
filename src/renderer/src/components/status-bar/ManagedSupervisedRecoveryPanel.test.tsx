import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ManagedSupervisedRecoveryPanel } from './ManagedSupervisedRecoveryPanel'

function render(packet?: unknown, qaLifecycle?: unknown): string {
  return renderToStaticMarkup(
    <ManagedSupervisedRecoveryPanel packet={packet} qaLifecycle={qaLifecycle} />
  )
}

describe('Gate 9B-C4-C-A — Electron supervised recovery QA view, no actions', () => {
  it('renders a blocked, accessible QA-only view before any packet source exists', () => {
    const html = render()
    expect(html).toContain('Diagnóstico de recuperación supervisada')
    expect(html).toContain('BLOQUEADO')
    expect(html).toContain('Sin diagnóstico QA conectado')
    expect(html).toContain('data-recovery-startup-allowed="false"')
    expect(html).not.toMatch(/<button\b|<a\b|<input\b|<form\b/i)
  })

  it('never offers a force-start or PID termination control for an invalid packet', () => {
    const html = render({
      state: 'READY_TO_RESTART',
      startupAllowed: true,
      priorProcess: { pid: 999, owner: 'TRUSTED' },
      instructions: 'Matar PID y reiniciar'
    })
    expect(html).toContain('BLOQUEADO')
    expect(html).not.toContain('READY_TO_RESTART')
    expect(html).not.toContain('Matar PID')
    expect(html).not.toMatch(/<button\b|<a\b|<input\b|<form\b/i)
  })

  it('presents a native own-QA claim separately from unverified historic CLEAN_STOP', () => {
    const html = render({
      state: 'BLOCKED',
      startupAllowed: false,
      supervisorReviewRequired: true,
      diagnosticsOnly: true,
      currentInstance: {
        state: 'CURRENT_QA_PROCESS_ONLY',
        pid: 22111,
        creationTimeTicks: '133776550123456789',
        reason: null
      },
      previousOwner: { state: 'UNVERIFIED', reason: 'CLEAN_STOP_HISTORY_UNATTESTED' }
    })
    expect(html).toContain('Proceso QA actual observado')
    expect(html).toContain('sin autenticación histórica')
    expect(html).toContain('Descendientes del Job Object anterior')
    expect(html).not.toContain('133776550123456789')
    expect(html).not.toContain('22111')
    expect(html).not.toMatch(/<button\b|<a\b|<input\b|<form\b/i)
  })

  it('drops arbitrary error text and executable paths even when part of an otherwise valid QA packet', () => {
    const html = render({
      state: 'BLOCKED',
      startupAllowed: false,
      supervisorReviewRequired: true,
      diagnosticsOnly: true,
      currentInstance: {
        state: 'UNKNOWN', reason: 'AUTH_TOKEN=secret',
        executablePath: 'C:\\sensitive\\python.exe'
      },
      previousOwner: {
        state: 'UNVERIFIED', reason: 'C:\\sensitive\\historical-secret.json'
      },
      missingEvidence: ['HIDE_BLOCK']
    })
    expect(html).not.toContain('AUTH_TOKEN')
    expect(html).not.toContain('python.exe')
    expect(html).not.toContain('historical-secret.json')
    expect(html).not.toContain('HIDE_BLOCK')
    expect(html).toContain('BLOQUEADO')
  })
})


describe('Gate 9B-C4-C-B Electron QA lifecycle is visible but never authoritative', () => {
  it('shows no QA lifecycle when the guarded main snapshot is unavailable', () => {
    const html = render()
    expect(html).toContain('Sin estado QA confiable de la sesión actual')
    expect(html).toContain('BLOQUEADO')
    expect(html).not.toMatch(/<button\b|<a\b|<input\b|<form\b/i)
  })

  it('displays a sanitized current QA lifecycle separately from the historical journal', () => {
    const html = render(undefined, {
      phase: 'ONLINE', owner: 'THIS_ELECTRON', port: 55001, restarts: 3
    })
    expect(html).toContain('Ciclo QA de Electron: En línea')
    expect(html).toContain('Sin evidencia histórica autenticada')
    expect(html).toContain('Sin diagnóstico QA conectado')
    expect(html).toContain('BLOQUEADO')
    expect(html).not.toContain('55001')
  })

  it('cannot surface secrets through untrusted lifecycle error codes or paths', () => {
    const html = render(undefined, {
      phase: 'ERROR', owner: 'NONE',
      error_code: 'FATAL_C:\\private\\credentials.json',
      executable: 'C:\\private\\python.exe',
      token: 'SUPER_SECRET',
      startupAllowed: true
    })
    expect(html).toContain('BLOQUEADO')
    expect(html).toContain('Ciclo QA de Electron: Error')
    for(const secret of ['credentials.json', 'python.exe', 'SUPER_SECRET']){
      expect(html).not.toContain(secret)
    }
    expect(html).not.toMatch(/<button\b|<a\b|<input\b|<form\b/i)
  })

  it('rejects inconsistent ONLINE-without-owner input and keeps startup disabled', () => {
    const html = render(undefined, { phase: 'ONLINE', owner: 'NONE' })
    expect(html).toContain('Sin estado QA confiable de la sesión actual')
    expect(html).toContain('data-recovery-startup-allowed="false"')
  })
})
