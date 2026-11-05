import { expect, test } from './helpers/orca-app'

// Negative end-to-end gate: a hidden, disposable Electron session must NOT
// reuse tokens from the operator's live WCB/Edge QA feed on port 8770.
test.use({
  seedTestRepo: false,
  orcaAppExtraEnv: {
    ORCA_EDGE_QA_MODE: '1',
    ORCA_EDGE_QA_PORT: '8770',
    ORCA_EDGE_E2E_PORT: ''
  }
})

test('isolated Orcastrator Desktop recognizes QA 8770 without host credentials', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  const windowVisible = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((win) => win.isVisible())
  )
  expect(windowVisible).toBe(false)

  const health = await orcaPage.evaluate(() => window.api.managed.edgeHealth())
  expect(health).toEqual({
    status: 'NOT_CONFIGURED',
    port: 8770,
    error_code: 'LOCAL_FEED_TOKEN_MISSING'
  })

  const managed = orcaPage.getByRole('button', { name: 'Proyectos Gestionados' })
  await expect(managed).toHaveCount(1)
  const message = orcaPage.getByText('Feed WCB sin configurar', { exact: true })
  if (!(await message.isVisible())) await managed.click()
  await expect(message).toBeVisible()
  await expect(orcaPage.getByText('8770', { exact: true })).toBeVisible()

  // QA label is informational only: neither WCB nor Edge is launched.
  await orcaPage.screenshot({ path: testInfo.outputPath('orcastrator-qa8770-isolated.png') })
})
