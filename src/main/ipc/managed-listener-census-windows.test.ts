import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadWindowsSecurity } from '../../shared/windows-security-addon'

// Gate 9B-C3-B: Only read-only Win32 table inspection of synthetic TCP
// listeners on kernel-assigned ports. No FastAPI, WCB or operational ports.
const onlyWindows = process.platform === 'win32' ? describe : describe.skip

function addon() {
  const loaded = loadWindowsSecurity()
  if ('error' in loaded) throw new Error('GATE9C3_NATIVE_ADDON_LOAD_FAILED: ' + loaded.error)
  expect(loaded.addon.hasNativeExport('inspectManagedQaTcpListeners')).toBe(true)
  return loaded.addon
}

async function startLocalServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => socket.destroy())
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('GATE9C3_NO_EPHEMERAL_ADDRESS'))
        return
      }
      resolve(addr.port)
    })
  })
  return { server, port }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

async function waitUntil(check: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('GATE9C3_TIMEOUT')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function minimalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ORCA_GATE9C3_TEST_ONLY: '1' }
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'Path', 'PATHEXT']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

async function startForeignFixture(): Promise<{
  child: ChildProcess
  pid: number
  port: number
}> {
  const fixture = path.resolve(process.cwd(), 'tests/fixtures/orca-gate9c3-tcp-owner.cjs')
  const child = spawn(process.execPath, [fixture], {
    env: minimalEnv(),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    shell: false,
    windowsHide: true
  })
  return new Promise((resolve, reject) => {
    let settled = false
    let output = ''
    let errors = ''
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('GATE9C3_FOREIGN_FIXTURE_TIMEOUT ' + errors.slice(0, 300)))
    }, 10000)
    child.stderr?.on('data', (chunk: Buffer) => { errors += chunk.toString('utf8') })
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
      if (settled || !output.includes('\n')) return
      settled = true
      clearTimeout(timer)
      try {
        const report = JSON.parse(output.slice(0, output.indexOf('\n'))) as {
          pid: number
          port: number
        }
        if (report.pid !== child.pid || !Number.isInteger(report.port)) {
          throw new Error('GATE9C3_UNTRUSTED_FIXTURE_REPORT')
        }
        resolve({ child, ...report })
      } catch (error) {
        child.kill()
        reject(error)
      }
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('GATE9C3_EARLY_EXIT ' + code + ' ' + errors.slice(0, 300)))
    })
  })
}

async function closeFixture(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()) })
  child.send?.('close')
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('GATE9C3_FIXTURE_EXIT_TIMEOUT')), 5000)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill() // ONLY our own ChildProcess handle.
    }
  }
}

onlyWindows('Gate 9B-C3 native read-only TCP census', () => {
  it('sees an own ephemeral TCP listener with PID, Win32 creation time and executable', async () => {
    const native = addon()
    const { server, port } = await startLocalServer()
    try {
      await waitUntil(() => native.inspectManagedQaTcpListeners(port).status === 'LISTENER_PRESENT')
      const result = native.inspectManagedQaTcpListeners(port)
      expect(result.status).toBe('LISTENER_PRESENT')
      if (result.status !== 'LISTENER_PRESENT') return
      const owner = result.listeners.find((row) => row.pid === process.pid)
      expect(owner).toBeDefined()
      expect(owner?.family).toBe('IPv4')
      expect(owner?.identityVerified).toBe(true)
      expect(owner?.creationTimeTicks).toMatch(/^[0-9]{12,}$/)
      expect(owner?.executablePath).toEqual(expect.any(String))
    } finally {
      await closeServer(server)
    }
    // Snapshot is read-only: after the server closes, listener is gone.
    await waitUntil(() => native.inspectManagedQaTcpListeners(port).status === 'NO_LISTENER')
  }, 15000)

  it('detects a separate synthetic listener by its own PID without interfering', async () => {
    const native = addon()
    const foreign = await startForeignFixture()
    try {
      const first = native.inspectManagedQaTcpListeners(foreign.port)
      expect(first.status).toBe('LISTENER_PRESENT')
      if (first.status !== 'LISTENER_PRESENT') return
      expect(first.listeners.some((row) =>
        row.pid === foreign.pid && row.creationTimeTicks !== null &&
        row.identityVerified
      )).toBe(true)
      // Two observations may happen without touching the live process.
      const second = native.inspectManagedQaTcpListeners(foreign.port)
      expect(second.status).toBe('LISTENER_PRESENT')
      expect(foreign.child.exitCode).toBe(null)
    } finally {
      await closeFixture(foreign.child)
    }
    await waitUntil(() => native.inspectManagedQaTcpListeners(foreign.port).status === 'NO_LISTENER')
  }, 15000)

  it('refuses reserved operational and WCB ports, bad arguments and non-ephemeral values', () => {
    const native = addon()
    for (const reserved of [8765, 8768, 8769, 18765]) {
      expect(() => native.inspectManagedQaTcpListeners(reserved)).toThrow()
    }
    for (const invalid of [0, -1, 80, 65536, 1234.5, Number.NaN]) {
      expect(() => native.inspectManagedQaTcpListeners(invalid)).toThrow()
    }
  })
})
