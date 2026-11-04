import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test as base } from './helpers/orca-app'

type SyntheticFeed = {
  port: number
  token: string
  getAuthenticatedRequests: () => number
}

// A real HTTP server, but only with synthetic credentials on an OS-assigned
// loopback port. The headless Electron fixture owns a disposable HOME.
// No user tokens, real WCB receipts, or production Edge feed are accessed.
const test = base.extend<{ syntheticFeed: SyntheticFeed }>({
  // eslint-disable-next-line no-empty-pattern
  syntheticFeed: async ({}, use) => {
    const token = 'orca-e2e-feed-' + 'x'.repeat(48)
    let authenticatedRequests = 0
    const server = createServer((request, response) => {
      if (request.url !== '/v2/health' || request.method !== 'GET') {
        response.writeHead(404).end()
        return
      }
      if (request.headers.authorization !== 'Bearer ' + token) {
        response.writeHead(401, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: 'AUTH_REQUIRED' }))
        return
      }
      authenticatedRequests += 1
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({ ok: true, generation: 'a'.repeat(32), latest_seq: 7 })
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    try {
      await use({
        port: address.port,
        token,
        getAuthenticatedRequests: () => authenticatedRequests
      })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  },
  orcaAppExtraEnv: async ({ syntheticFeed }, use) => {
    await use({
      ORCA_EDGE_QA_MODE: '1',
      ORCA_EDGE_E2E_PORT: String(syntheticFeed.port)
    })
  }
})

test.use({ seedTestRepo: false })

test('hidden Electron authenticates with a synthetic loopback feed', async ({
  syntheticFeed,
  electronApp,
  orcaPage
}, testInfo) => {
  const anyVisible = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((win) => win.isVisible())
  )
  expect(anyVisible).toBe(false)

  // This HOME is verified by the existing Electron E2E launcher as isolated.
  const home = await electronApp.evaluate(({ app }) => app.getPath('home'))
  const dir = join(home, 'AppData', 'Local', 'Orcastrator', 'bridge', 'edge-chat-bridge')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'token.txt'), syntheticFeed.token, { encoding: 'utf8', flag: 'wx' })

  const result = await orcaPage.evaluate(() => window.api.managed.edgeHealth())
  expect(result).toEqual({ status: 'ONLINE', port: syntheticFeed.port, latest_seq: 7 })
  expect(JSON.stringify(result)).not.toContain(syntheticFeed.token)
  expect(syntheticFeed.getAuthenticatedRequests()).toBeGreaterThan(0)

  const managed = orcaPage.getByRole('button', { name: 'Proyectos Gestionados' })
  await expect(managed).toHaveCount(1)
  // The feed can still show its previous state while the 15s UI poll catches up.
  // Never toggle the popover based on the ONLINE label: if it is already open,
  // clicking the trigger would CLOSE the panel and make the assertion time out.
  const panelTitle = orcaPage.getByText('Proyectos Gestionados', { exact: true })
  if (!(await panelTitle.isVisible())) {
    await managed.click()
  }
  await expect(panelTitle).toBeVisible()
  const online = orcaPage.getByText('Feed WCB activo', { exact: true })
  await expect(online).toBeVisible({ timeout: 25000 })
  await expect(orcaPage.getByText(String(syntheticFeed.port), { exact: true }))
    .toBeVisible({ timeout: 25000 })
  await orcaPage.screenshot({ path: testInfo.outputPath('orcastrator-feed-synthetic.png') })
})
