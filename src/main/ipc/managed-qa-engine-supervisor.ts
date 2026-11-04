/**
 * ORCA-D02 Gate 9A: Electron-owned, disposable QA FastAPI lifecycle.
 *
 * It NEVER launches the operational Python engine. The only admissible entry
 * is a hidden Electron E2E on Windows, inside ORCASTRATOR-DESKTOP-QA, with
 * explicit opt-in and a pinned sibling QA Python/motor checkout.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export type QaEnginePhase =
  | 'DISABLED'
  | 'STOPPED'
  | 'STARTING'
  | 'ONLINE'
  | 'DEGRADED'
  | 'RECOVERING'
  | 'ERROR'
  | 'STOPPING'

export type QaEngineLifecycleStatus = {
  readonly phase: QaEnginePhase
  readonly owner: 'NONE' | 'THIS_ELECTRON'
  readonly port: number | null
  readonly restarts: number
  readonly error_code?: string
}

type Paths = { readonly motor: string; readonly python: string; readonly script: string }
const RESERVED_PORTS = new Set([8765, 8768, 8769, 18765])
const RESTART_LIMIT = 2

// A visible user session, a packaged app, or any other checkout can only
// inspect status. They cannot cause a process launch through this module.
export function gate9QaEnabled(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): boolean {
  return (
    process.platform === 'win32' &&
    env.ORCA_E2E_HEADLESS === '1' &&
    env.ORCA_MANAGED_QA_AUTOSTART === '1' &&
    path.basename(path.dirname(cwd)).toLowerCase() === 'orcastrator-desktop-qa' &&
    path.basename(cwd).toLowerCase() === 'orca'
  )
}

function requirePaths(): Paths {
  if (!gate9QaEnabled()) throw new Error('GATE9_QA_ONLY')
  const cwd = path.resolve(process.cwd())
  const motor = path.resolve(cwd, '..', 'motor')
  const python = path.resolve(cwd, '..', '.venv-motor-qa', 'Scripts', 'python.exe')
  const script = path.join(motor, 'tests', 'support', 'gate7_fastapi_server.py')
  if (
    !process.env.ORCA_QA_MOTOR_REPO_DIR ||
    path.resolve(process.env.ORCA_QA_MOTOR_REPO_DIR).toLowerCase() !== motor.toLowerCase() ||
    !process.env.ORCA_QA_PYTHON ||
    path.resolve(process.env.ORCA_QA_PYTHON).toLowerCase() !== python.toLowerCase() ||
    !existsSync(python) ||
    !existsSync(script)
  ) {
    throw new Error('GATE9_QA_PATHS_INVALID')
  }
  return { motor, python, script }
}

function qaChildEnv(token: string, root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of [
    'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'Path',
    'PATHEXT', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA'
  ]) {
    if (process.env[key]) env[key] = process.env[key]
  }
  env.ORCA_GATE7_TEST_ONLY = '1'
  env.ORCA_GATE7_TMP_DIR = root
  env.ORCA_GATE7_BRIDGE_TOKEN = token
  env.PYTHONNOUSERSITE = '1'
  env.PYTHONDONTWRITEBYTECODE = '1'
  return env
}

export class ManagedQaEngineSupervisor {
  private child: ChildProcess | null = null
  private root: string | null = null
  private stopRequested = false
  private starting: Promise<QaEngineLifecycleStatus> | null = null
  private phase: QaEnginePhase = 'STOPPED'
  private errorCode: string | undefined
  private port: number | null = null
  private token: string | null = null
  private restarts = 0
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null
  private healthTimer: ReturnType<typeof setInterval> | null = null
  private healthInFlight = false

  snapshot(): QaEngineLifecycleStatus {
    if (!gate9QaEnabled()) {
      return { phase: 'DISABLED', owner: 'NONE', port: null, restarts: 0 }
    }
    return {
      phase: this.phase,
      owner: this.child ? 'THIS_ELECTRON' : 'NONE',
      port: this.port,
      restarts: this.restarts,
      ...(this.errorCode ? { error_code: this.errorCode } : {})
    }
  }

  async start(): Promise<QaEngineLifecycleStatus> {
    if (!gate9QaEnabled()) return this.snapshot()
    if (this.stopRequested) return this.snapshot()
    if (this.phase === 'ONLINE' && this.child) return this.snapshot()
    if (this.starting) return this.starting
    this.starting = this.startInternal().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async startInternal(): Promise<QaEngineLifecycleStatus> {
    this.phase = this.restarts > 0 ? 'RECOVERING' : 'STARTING'
    this.errorCode = undefined
    let paths: Paths
    try {
      paths = requirePaths()
    } catch {
      this.phase = 'ERROR'
      this.errorCode = 'QA_PATH_PREFLIGHT_FAILED'
      return this.snapshot()
    }

    const root = mkdtempSync(path.join(tmpdir(), 'orca-gate7-'))
    const token = 'mbt_' + randomBytes(24).toString('hex')
    let child: ChildProcess
    try {
      child = spawn(paths.python, ['-I', '-B', '-u', paths.script], {
        cwd: paths.motor,
        env: qaChildEnv(token, root),
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      rmSync(root, { recursive: true, force: true })
      this.phase = 'ERROR'
      this.errorCode = 'QA_SPAWN_FAILED'
      return this.snapshot()
    }
    this.child = child
    this.root = root
    this.token = token
    child.stderr?.resume() // Consume diagnostics; never print keys or paths.
    child.once('exit', () => this.onChildExit(child))

    try {
      const port = await new Promise<number>((resolve, reject) => {
        let completed = false
        let stream = ''
        const settle = (error?: Error, value?: number) => {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          child.stdout?.off('data', onData)
          child.off('error', onError)
          child.off('exit', onExit)
          if (error) reject(error)
          else resolve(value as number)
        }
        const timeout = setTimeout(() => settle(new Error('STARTUP_TIMEOUT')), 30_000)
        const onData = (data: Buffer) => {
          stream = (stream + data.toString('utf8')).slice(-512)
          const match = /ORCA_GATE7_READY ([0-9]+)/.exec(stream)
          if (match) settle(undefined, Number(match[1]))
        }
        const onError = () => settle(new Error('SPAWN_FAILED'))
        const onExit = () => settle(new Error('PROCESS_EXIT_BEFORE_READY'))
        child.stdout?.on('data', onData)
        child.once('error', onError)
        child.once('exit', onExit)
      })
      if (
        !Number.isInteger(port) || port < 1024 || port > 65535 ||
        RESERVED_PORTS.has(port) || child.exitCode !== null || child.signalCode !== null ||
        this.stopRequested || this.child !== child
      ) {
        throw new Error('UNSAFE_READY_STATE')
      }
      const healthy = await this.checkHealth(port)
      if (!healthy || this.stopRequested || this.child !== child) {
        throw new Error('HEALTH_NOT_READY')
      }

      // Only after the owned instance passes /api/health, route the hidden
      // Electron test renderer to its randomly generated endpoint.
      process.env.MANAGED_PROFILE = 'STAGING_LOCAL'
      process.env.MANAGED_PORT = String(port)
      process.env.MANAGED_BRIDGE_TOKEN = token
      this.port = port
      this.phase = 'ONLINE'
      this.errorCode = undefined
      this.beginHealthChecks()
      return this.snapshot()
    } catch {
      this.phase = 'ERROR'
      this.errorCode = 'QA_ENGINE_NOT_READY'
      this.killOwnedChild()
      return this.snapshot()
    }
  }

  private async checkHealth(port: number): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      })
      if (!response.ok) return false
      const json = await response.json() as Record<string, unknown>
      return json.status === 'OK' && Number.isInteger(json.schema_version)
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  private beginHealthChecks(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = setInterval(() => {
      if (this.healthInFlight || !this.child || !this.port || this.stopRequested) return
      this.healthInFlight = true
      void this.checkHealth(this.port).then((healthy) => {
        if (this.phase === 'ONLINE' && !healthy) {
          this.phase = 'DEGRADED'
          this.errorCode = 'QA_HEALTH_FAILED'
        } else if (this.phase === 'DEGRADED' && healthy) {
          this.phase = 'ONLINE'
          this.errorCode = undefined
        }
      }).finally(() => { this.healthInFlight = false })
    }, 4000)
    this.healthTimer.unref()
  }

  private onChildExit(child: ChildProcess): void {
    if (this.child !== child) return
    this.clearTimers()
    this.child = null
    this.clearEndpoint()
    this.cleanupRoot()
    if (this.stopRequested) {
      this.phase = 'STOPPED'
      return
    }
    this.phase = 'ERROR'
    this.errorCode = 'QA_CHILD_EXITED'
    if (this.restarts >= RESTART_LIMIT) {
      this.errorCode = 'QA_RESTART_LIMIT_REACHED'
      return
    }
    this.restarts += 1
    this.phase = 'RECOVERING'
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      if (!this.stopRequested && !this.child) void this.start()
    }, 1000 * this.restarts)
    this.recoveryTimer.unref()
  }

  private clearEndpoint(): void {
    const port = this.port
    const token = this.token
    if (port && process.env.MANAGED_PORT === String(port)) {
      delete process.env.MANAGED_PORT
    }
    if (token && process.env.MANAGED_BRIDGE_TOKEN === token) {
      delete process.env.MANAGED_BRIDGE_TOKEN
    }
    this.port = null
    this.token = null
  }

  private clearTimers(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.healthTimer = null
    this.recoveryTimer = null
  }

  private cleanupRoot(): void {
    if (!this.root) return
    const root = this.root
    this.root = null
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
    catch { /* Best effort; no teardown of unrelated locations. */ }
  }

  private killOwnedChild(): void {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill()
    }
  }

  // The only process termination target is the ChildProcess retained from
  // this instance's own spawn. NEVER discover/kill by PID, port or process name.
  stop(): QaEngineLifecycleStatus {
    this.stopRequested = true
    this.clearTimers()
    this.phase = this.child ? 'STOPPING' : 'STOPPED'
    this.killOwnedChild()
    this.clearEndpoint()
    if (!this.child) this.cleanupRoot()
    return this.snapshot()
  }
}

export const qaEngineSupervisor = new ManagedQaEngineSupervisor()
