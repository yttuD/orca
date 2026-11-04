import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ManagedSupervisedRecoveryPanel } from './ManagedSupervisedRecoveryPanel'

function render(packet?: unknown): string {
  return renderToStaticMarkup(<ManagedSupervisedRecoveryPanel packet={packet} />)
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
