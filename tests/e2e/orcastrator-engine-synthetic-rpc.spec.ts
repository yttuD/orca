import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test as base } from './helpers/orca-app'

type RejectedRequest = {
  method: string
  path: string
  status: number
  reason: 'UNEXPECTED_ROUTE' | 'AUTH_MISMATCH' | 'INVALID_JSON' | 'RPC_DENIED'
}

type SyntheticEngine = {
  port: number
  token: string
  authenticatedMethods: string[]
  getRejectedRequests: () => readonly RejectedRequest[]
}

// Real loopback HTTP, disposable Electron profile, fake engine/token.
// The production Python motor on 8765 is never contacted or started.
const test = base.extend<{ syntheticEngine: SyntheticEngine }>({
  // eslint-disable-next-line no-empty-pattern
  syntheticEngine: async ({}, use) => {
    const token = 'orca-e2e-engine-' + 'x'.repeat(48)
    const authenticatedMethods: string[] = []
    const rejectedRequests: RejectedRequest[] = []
    const server = createServer((request, response) => {
      // Record only method, pathname and classification, never credentials,
      // headers, request bodies, or query strings.
      const fail = (code: number, reason: RejectedRequest['reason']) => {
        rejectedRequests.push({
          method: request.method || 'UNKNOWN',
          path: (request.url || '').split('?')[0],
          status: code,
          reason
        })
        response.writeHead(code, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ ok: false, error_code: 'SYNTHETIC_DENIED' }))
      }
      if (request.method !== 'POST' || request.url !== '/api/managed/rpc') {
        fail(404, 'UNEXPECTED_ROUTE')
        return
      }
      if (
        request.headers.authorization !== 'Bearer ' + token ||
        request.headers['x-managed-profile'] !== 'STAGING_LOCAL'
      ) {
        fail(401, 'AUTH_MISMATCH')
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      request.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 32768) {
          request.destroy()
          return
        }
        chunks.push(chunk)
      })
      request.on('end', () => {
        if (size > 32768) return
        let rpc: Record<string, unknown>
        try {
          rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
        } catch {
          fail(400, 'INVALID_JSON')
          return
        }
        const method = rpc.method
        if (
          rpc.protocol === null ||
          typeof rpc.protocol !== 'object' ||
          !rpc.caller ||
          typeof rpc.caller !== 'object' ||
          (rpc.caller as Record<string, unknown>).surface !== 'renderer' ||
          (rpc.protocol as Record<string, unknown>).name !== 'managed' ||
          (rpc.protocol as Record<string, unknown>).major !== 1 ||
          (method !== 'managed.listProjects' && method !== 'managed.listTasks')
        ) {
          fail(403, 'RPC_DENIED')
          return
        }
        authenticatedMethods.push(method)
        const data = method === 'managed.listProjects'
          ? { projects: [{
              id: 'qa-synthetic-project',
              name: 'Orcastrator QA Synthetic',
              description: 'Disposable read-only test project',
              status: 'ACTIVE',
              mode: 'MANAGED'
            }] }
          : { project_id: 'qa-synthetic-project', tasks: [] }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ ok: true, data }))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      await use({
        port: (server.address() as AddressInfo).port,
        token,
        authenticatedMethods,
        getRejectedRequests: () => [...rejectedRequests]
      })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      )
    }
  },
  orcaAppExtraEnv: async ({ syntheticEngine }, use) => {
    // Explicit profile prevents an ambient .active_profile from changing the test endpoint.
    // The token exists only in the Electron E2E child process environment.
    await use({
      MANAGED_PROFILE: 'STAGING_LOCAL',
      MANAGED_PORT: String(syntheticEngine.port),
      MANAGED_BRIDGE_TOKEN: syntheticEngine.token
    })
  }
})

test.use({ seedTestRepo: false })

test('hidden Electron reads authenticated synthetic Managed projects through IPC', async ({
  syntheticEngine,
  electronApp,
  orcaPage
}, testInfo) => {
  const anyVisible = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((win) => win.isVisible())
  )
  expect(anyVisible).toBe(false)

  const result = await orcaPage.evaluate(() => window.api.managed.listProjects())
  expect(result).toMatchObject({
    ok: true,
    status: 'ONLINE',
    projects: [{ id: 'qa-synthetic-project', name: 'Orcastrator QA Synthetic' }]
  })
  expect(JSON.stringify(result)).not.toContain(syntheticEngine.token)
  expect(syntheticEngine.authenticatedMethods).toContain('managed.listProjects')

  const managed = orcaPage.getByRole('button', { name: 'Proyectos Gestionados' })
  await expect(managed).toHaveCount(1)
  const panelTitle = orcaPage.getByText('Proyectos Gestionados', { exact: true })
  if (!(await panelTitle.isVisible())) await managed.click()
  await expect(panelTitle).toBeVisible()

  await expect(
    orcaPage.getByText('Orcastrator QA Synthetic', { exact: true })
  ).toBeVisible({ timeout: 25000 })
  expect(syntheticEngine.getRejectedRequests()).toEqual([])
  expect(syntheticEngine.authenticatedMethods.every(
    (method) => method === 'managed.listProjects' || method === 'managed.listTasks'
  )).toBe(true)
  await orcaPage.screenshot({ path: testInfo.outputPath('orcastrator-managed-rpc-synthetic.png') })
})
