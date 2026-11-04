import { describe, expect, it } from 'vitest'
import { gate9QaEnabled, ManagedQaEngineSupervisor } from './managed-qa-engine-supervisor'

const qaCwd = 'D:\\Programacion-Cosas\\ORCASTRATOR-DESKTOP-QA\\orca'
const env = {
  ORCA_E2E_HEADLESS: '1',
  ORCA_MANAGED_QA_AUTOSTART: '1',
  ORCA_QA_PYTHON: 'D:\\Programacion-Cosas\\ORCASTRATOR-DESKTOP-QA\\.venv-motor-qa\\Scripts\\python.exe',
  ORCA_QA_MOTOR_REPO_DIR: 'D:\\Programacion-Cosas\\ORCASTRATOR-DESKTOP-QA\\motor'
}

describe('ORCA-D02 Gate 9A managed QA engine admission', () => {
  it('does not admit non-Windows hosts', () => {
    expect(gate9QaEnabled(env, qaCwd, 'linux')).toBe(false)
  })
  it('does not admit visible Electron sessions', () => {
    expect(gate9QaEnabled({ ...env, ORCA_E2E_HEADLESS: '0' }, qaCwd, 'win32')).toBe(false)
  })
  it('does not admit a missing explicit QA opt-in', () => {
    expect(gate9QaEnabled({ ...env, ORCA_MANAGED_QA_AUTOSTART: '0' }, qaCwd, 'win32')).toBe(false)
  })
  it('does not admit an operational checkout', () => {
    expect(gate9QaEnabled(env, 'D:\\Programacion-Cosas\\ORQUESTADOR-MASTER', 'win32')).toBe(false)
  })
  it('does not admit an adjacent checkout named something else', () => {
    expect(gate9QaEnabled(env, 'D:\\Programacion-Cosas\\ORCASTRATOR-DESKTOP-QA\\motor', 'win32')).toBe(false)
  })
  it('requires the dedicated Windows QA checkout', () => {
    // Check a Windows-style path without depending on the host OS path parser.
    if (process.platform !== 'win32') return
    expect(gate9QaEnabled(env, qaCwd, 'win32')).toBe(true)
  })
  it('returns DISABLED rather than launching on ordinary test hosts', async () => {
    if (process.platform === 'win32' && gate9QaEnabled()) return
    const subject = new ManagedQaEngineSupervisor()
    const before = subject.snapshot()
    expect(before).toMatchObject({
      phase: 'DISABLED', owner: 'NONE', port: null, restarts: 0
    })
    const after = await subject.start()
    expect(after).toMatchObject({
      phase: 'DISABLED', owner: 'NONE', port: null, restarts: 0
    })
    expect(subject.simulateCrashForQa()).toMatchObject({ phase: 'DISABLED' })
    expect(subject.stop()).toMatchObject({ phase: 'DISABLED' })
  })
})
