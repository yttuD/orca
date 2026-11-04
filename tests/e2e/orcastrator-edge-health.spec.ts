import { expect, test } from './helpers/orca-app'

// The E2E fixture creates a disposable Electron userData + HOME; no QA or
// production feed tokens are copied from the host.
test.use({
  seedTestRepo: false,
  orcaAppExtraEnv: { ORCA_EDGE_QA_MODE: '1' }
})

test('isolated hidden Electron exposes QA feed diagnostics but no host credentials', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  const isWindowVisible = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((win) => win.isVisible())
  )
  expect(isWindowVisible).toBe(false)

  const health = await orcaPage.evaluate(() => window.api.managed.edgeHealth())
  expect(health).toEqual({
    status: 'NOT_CONFIGURED',
    port: 8769,
    error_code: 'LOCAL_FEED_TOKEN_MISSING'
  })

  // The managed status-bar surface is present in the real renderer, but
  // no WCB action is dispatched and no native consent dialogue is opened.
  const managedTrigger = orcaPage.getByRole('button', { name: 'Proyectos Gestionados' })
  await expect(managedTrigger).toHaveCount(1)
  const feedState = orcaPage.getByText('Feed WCB sin configurar', { exact: true })
  if (!(await feedState.isVisible())) {
    await managedTrigger.click()
  }
  await expect(feedState).toBeVisible()
  await expect(orcaPage.getByText('8769', { exact: true })).toBeVisible()

  // Screenshot is a CDP capture of the hidden, disposable test renderer.
  await orcaPage.screenshot({ path: testInfo.outputPath('orcastrator-edge-qa-hidden.png') })
})
