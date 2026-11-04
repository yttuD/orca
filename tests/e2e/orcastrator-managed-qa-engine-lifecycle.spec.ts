import { expect, test } from './helpers/orca-app'

// Gate 9A: Electron, NOT the Playwright fixture, owns the real QA Python
// FastAPI subprocess. It must never start a normal or staging operator motor.
test.use({
  seedTestRepo: false,
  orcaAppExtraEnv: {
    ORCA_MANAGED_QA_AUTOSTART: '1',
    ORCA_QA_MOTOR_REPO_DIR: process.env.ORCA_QA_MOTOR_REPO_DIR || '',
    ORCA_QA_PYTHON: process.env.ORCA_QA_PYTHON || '',
    MANAGED_PROFILE: 'STAGING_LOCAL'
  }
})

test('Desktop owns and recovers a disposable FastAPI child, then stops only its child', async ({
  electronApp, orcaPage
}, testInfo) => {
  test.setTimeout(140_000)
  expect(await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((window) => window.isVisible())
  )).toBe(false)

  await expect.poll(
    () => orcaPage.evaluate(() => window.api.managed.qaEngineLifecycle()),
    { timeout: 40_000 }
  ).toMatchObject({
    phase: 'ONLINE', owner: 'THIS_ELECTRON', restarts: 0
  })

  const firstStatus = await orcaPage.evaluate(() => window.api.managed.qaEngineLifecycle())
  expect(firstStatus.port).toBeGreaterThanOrEqual(1024)
  expect([8765, 8768, 8769, 18765]).not.toContain(firstStatus.port)

  const projects = await orcaPage.evaluate(() => window.api.managed.listProjects())
  expect(projects).toMatchObject({
    ok: true,
    status: 'ONLINE',
    projects: [{ name: 'Orcastrator Gate 7 Real FastAPI QA' }]
  })
  const id = projects.projects[0]?.id
  if (!id) throw new Error('GATE9_QA_PROJECT_MISSING')
  const tasks = await orcaPage.evaluate((projectId) => window.api.managed.listTasks(projectId), id)
  expect(tasks).toMatchObject({ ok: true, status: 'ONLINE', tasks: [] })

  const panel = orcaPage.getByRole('button', { name: 'Proyectos Gestionados' })
  await expect(panel).toHaveCount(1)
  const panelTitle = orcaPage.getByText('Proyectos Gestionados', { exact: true })
  if (!(await panelTitle.isVisible())) await panel.click()
  await expect(panelTitle).toBeVisible()
  // Electron's child was initialized after the renderer's first OFFLINE poll.
  // Refresh the actual user-facing panel BEFORE asserting a fresh project row.
  await orcaPage.getByTitle('Actualizar estado').click()
  await expect(orcaPage.getByText('Orcastrator Gate 7 Real FastAPI QA', { exact: true }))
    .toBeVisible({ timeout: 20_000 })
  await expect(orcaPage.getByText('Motor QA administrado: ONLINE', { exact: true }))
    .toBeVisible({ timeout: 20_000 })

  // Only the test-owned child is terminated. The supervisor must observe the
  // process exit, invalidate its old endpoint and recover at most twice.
  const crash = await orcaPage.evaluate(() => window.api.managed.qaCrashEngine())
  expect(crash.ok).toBe(true)

  await expect.poll(
    () => orcaPage.evaluate(() => window.api.managed.qaEngineLifecycle()),
    { timeout: 40_000 }
  ).toMatchObject({
    phase: 'ONLINE', owner: 'THIS_ELECTRON', restarts: 1
  })
  const recovered = await orcaPage.evaluate(() => window.api.managed.listProjects())
  expect(recovered).toMatchObject({
    ok: true,
    status: 'ONLINE',
    projects: [{ name: 'Orcastrator Gate 7 Real FastAPI QA' }]
  })

  await orcaPage.screenshot({
    path: testInfo.outputPath('orcastrator-gate9-qa-supervisor.png')
  })

  const stop = await orcaPage.evaluate(() => window.api.managed.qaStopEngine())
  expect(stop.ok).toBe(true)
  await expect.poll(
    () => orcaPage.evaluate(() => window.api.managed.qaEngineLifecycle()),
    { timeout: 15_000 }
  ).toMatchObject({
    phase: 'STOPPED', owner: 'NONE', port: null
  })
  const afterStop = await orcaPage.evaluate(() => window.api.managed.listProjects())
  expect(afterStop.ok).toBe(false)
  expect(afterStop.status).toBe('OFFLINE')
  // No implicit restart after explicit stop.
  await orcaPage.waitForTimeout(1500)
  expect(await orcaPage.evaluate(() => window.api.managed.qaEngineLifecycle())).toMatchObject({
    phase: 'STOPPED', owner: 'NONE', port: null, restarts: 1
  })
})
