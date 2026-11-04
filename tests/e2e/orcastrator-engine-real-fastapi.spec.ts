import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test as base } from './helpers/orca-app'

type Gate7Backend = {
  port: number
  token: string
  url: string
}

const QA_PROJECT_NAME = 'Orcastrator Gate 7 Real FastAPI QA'

// Cross-repo test: a REAL Python FastAPI HTTP server with temp SQLite and
// fake credentials, not a fake Node HTTP responder and never the live 8765.
const test = base.extend<{ gate7Backend: Gate7Backend }>({
  // eslint-disable-next-line no-empty-pattern
  gate7Backend: async ({}, use) => {
    const motorEnv = process.env.ORCA_QA_MOTOR_REPO_DIR
    const pythonEnv = process.env.ORCA_QA_PYTHON
    const expectedMotor = path.resolve(process.cwd(), '..', 'motor')
    const qaRoot = path.dirname(expectedMotor)
    const expectedPython = path.join(qaRoot, '.venv-motor-qa', 'Scripts', 'python.exe')

    if (
      path.basename(qaRoot).toLowerCase() !== 'orcastrator-desktop-qa' ||
      !motorEnv ||
      path.resolve(motorEnv).toLowerCase() !== expectedMotor.toLowerCase() ||
      !pythonEnv ||
      path.resolve(pythonEnv).toLowerCase() !== path.resolve(expectedPython).toLowerCase()
    ) {
      throw new Error('GATE7_QA_PATHS_REQUIRED: set ORCA_QA_MOTOR_REPO_DIR and ORCA_QA_PYTHON to the dedicated ORCASTRATOR-DESKTOP-QA paths.')
    }
    const serverScript = path.join(expectedMotor, 'tests', 'support', 'gate7_fastapi_server.py')
    if (!existsSync(serverScript) || !existsSync(expectedPython)) {
      throw new Error('GATE7_MOTOR_OR_PYTHON_MISSING: pull motor QA branch and install tests/requirements-gate7.txt.')
    }
    if (process.env.ORCA_E2E_FORCE_HEADFUL === '1') {
      throw new Error('GATE7_HIDDEN_ELECTRON_REQUIRED')
    }

    const token = 'mbt_' + randomBytes(24).toString('hex')
    const testRoot = mkdtempSync(path.join(os.tmpdir(), 'orca-gate7-'))
    let child: ChildProcess | undefined
    let capturedStderr = ''

    try {
      // The Python process receives a strict allowlist of OS variables.
      // Never inherit host Orca keys, production roots, provider tokens,
      // active profiles, PYTHONPATH, Github credentials or WCB grants.
      const safeEnv: NodeJS.ProcessEnv = {}
      for (const key of [
        'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'Path',
        'PATHEXT', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA'
      ]) {
        const value = process.env[key]
        if (value) safeEnv[key] = value
      }
      safeEnv.ORCA_GATE7_TEST_ONLY = '1'
      safeEnv.ORCA_GATE7_TMP_DIR = testRoot
      safeEnv.ORCA_GATE7_BRIDGE_TOKEN = token
      safeEnv.PYTHONNOUSERSITE = '1'
      safeEnv.PYTHONDONTWRITEBYTECODE = '1'

      child = spawn(expectedPython, ['-I', '-B', '-u', serverScript], {
        cwd: expectedMotor,
        env: safeEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      const pythonProcess = child
      pythonProcess.stderr?.on('data', (chunk: Buffer) => {
        capturedStderr = (capturedStderr + chunk.toString('utf8')).slice(-4000)
      })

      const port = await new Promise<number>((resolve, reject) => {
        let stdout = ''
        const timeout = setTimeout(() => reject(new Error('GATE7_FASTAPI_READY_TIMEOUT')), 30_000)
        const ready = (portValue: number) => {
          clearTimeout(timeout)
          resolve(portValue)
        }
        const fail = (message: string) => {
          clearTimeout(timeout)
          reject(new Error(message))
        }
        pythonProcess.stdout?.on('data', (chunk: Buffer) => {
          stdout = (stdout + chunk.toString('utf8')).slice(-4000)
          const match = /ORCA_GATE7_READY ([0-9]+)/.exec(stdout)
          if (match) ready(Number(match[1]))
        })
        pythonProcess.once('error', (error) => fail('GATE7_PYTHON_START_FAILED: ' + error.message))
        pythonProcess.once('exit', (code) => fail('GATE7_PYTHON_EXIT_BEFORE_READY: ' + String(code)))
      })

      if (!Number.isInteger(port) || port < 1024 || [8765, 8768, 8769, 18765].includes(port)) {
        throw new Error('GATE7_UNSAFE_LOCAL_PORT')
      }
      const url = `http://127.0.0.1:${port}`
      const response = await fetch(url + '/api/health')
      if (!response.ok || (await response.json() as { status?: string }).status !== 'OK') {
        throw new Error('GATE7_FASTAPI_HEALTH_FAILED')
      }

      await use({ port, token, url })
    } catch (error) {
      const detail = capturedStderr.replaceAll(token, '[REDACTED]')
      throw new Error(String(error) + (detail ? '\nQA Python stderr (redacted):\n' + detail : ''))
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const process = child
        const exited = new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 6000)
          process.once('exit', () => { clearTimeout(timer); resolve() })
        })
        process.kill()
        await exited
      }
      rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  },

  orcaAppExtraEnv: async ({ gate7Backend }, use) => {
    await use({
      MANAGED_PROFILE: 'STAGING_LOCAL',
      MANAGED_PORT: String(gate7Backend.port),
      MANAGED_BRIDGE_TOKEN: gate7Backend.token
    })
  }
})

test.use({ seedTestRepo: false })

test('hidden Electron reads real FastAPI projects over authenticated loopback and blocks mutations', async ({
  gate7Backend, electronApp, orcaPage
}, testInfo) => {
  test.setTimeout(120_000)
  expect(await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((win) => win.isVisible())
  )).toBe(false)

  const result = await orcaPage.evaluate(() => window.api.managed.listProjects())
  expect(result).toMatchObject({
    ok: true,
    status: 'ONLINE',
    projects: [{ name: QA_PROJECT_NAME }]
  })
  expect(JSON.stringify(result)).not.toContain(gate7Backend.token)
  const projectId = result.projects[0]?.id
  expect(projectId).toBeTruthy()

  const taskResult = await orcaPage.evaluate((id) => window.api.managed.listTasks(id), projectId)
  expect(taskResult).toMatchObject({ ok: true, status: 'ONLINE', tasks: [] })

  const managed = orcaPage.getByRole('button', { name: 'Proyectos Gestionados' })
  await expect(managed).toHaveCount(1)
  const panelTitle = orcaPage.getByText('Proyectos Gestionados', { exact: true })
  if (!(await panelTitle.isVisible())) await managed.click()
  await expect(panelTitle).toBeVisible()
  await expect(orcaPage.getByText(QA_PROJECT_NAME, { exact: true })).toBeVisible()

  const directRpc = async (method: string, token: string | null, profile: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Managed-Profile': profile
    }
    if (token) headers.Authorization = 'Bearer ' + token
    const response = await fetch(gate7Backend.url + '/api/managed/rpc', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        request_id: 'gate7-test-' + randomBytes(8).toString('hex'),
        protocol: { name: 'managed', major: 1, minor: 0 },
        method,
        caller: { surface: 'renderer', authenticated: true, capabilities: ['ALL_ADMIN'] },
        params: { project_id: projectId }
      })
    })
    expect(response.status).toBe(200)
    return await response.json() as {
      ok: boolean
      error_code: string | null
      effects_applied: boolean
      engine_state_unchanged: boolean
    }
  }

  const unauthenticated = await directRpc('managed.listProjects', null, 'STAGING_LOCAL')
  expect(unauthenticated).toMatchObject({ ok: false, error_code: 'AUTH_REQUIRED', effects_applied: false })
  const wrongProfile = await directRpc('managed.listProjects', gate7Backend.token, 'NORMAL')
  expect(wrongProfile).toMatchObject({ ok: false, error_code: 'AUTH_REQUIRED', effects_applied: false })
  const deniedDispatch = await directRpc('managed.requestDispatch', gate7Backend.token, 'STAGING_LOCAL')
  expect(deniedDispatch).toMatchObject({
    ok: false,
    error_code: 'READ_ONLY_WORKSPACE',
    effects_applied: false,
    engine_state_unchanged: true
  })
  await orcaPage.screenshot({ path: testInfo.outputPath('orcastrator-real-fastapi-gate7.png') })
})
