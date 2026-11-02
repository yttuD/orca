#!/usr/bin/env npx tsx
/**
 * Interactive Host for Manual Testing on Motorola Moto G20 (ORCA-05B).
 * Runs Python FastAPI engine + Orca Desktop Runtime RPC Server.
 * Keeps running until stopped. Auto-approves pending devices so pairing is seamless.
 */

import { spawn, execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { OrcaRuntimeService } from '../src/main/runtime/orca-runtime'
import { OrcaRuntimeRpcServer } from '../src/main/runtime/runtime-rpc'
import { makeStore } from '../src/main/runtime/runtime-rpc-worktree-store-fixtures'
import { partialRuntimeStore } from '../src/main/runtime/runtime-store-partial-fixture'
import { parsePairingCode } from '../src/shared/pairing'

const PYTHON_PORT = 8765
const ORCA_RPC_PORT = 6789
const REPO_ENGINE = resolve(__dirname, '../../ORQUESTADOR-MASTER')

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const adbExec = (cmd: string): string => {
  try {
    return execSync(`adb ${cmd}`, { encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

async function main(): Promise<void> {
  console.log('================================================================')
  console.log('       INICIANDO HOST ORCA PARA PRUEBA MANUAL (MOTO G20)        ')
  console.log('================================================================')

  // 1. ADB reverse tunnel
  console.log('[1/4] Configurando tunel ADB reverse tcp:6789...')
  adbExec('reverse tcp:6789 tcp:6789')
  console.log('  --> Tunel ADB reverse 6789: ACTIVO')

  // 2. Python engine
  console.log('[2/4] Iniciando Motor Python FastAPI en 127.0.0.1:8765...')
  const pyProcess = spawn(
    'python',
    ['scripts/start_e2e_engine.py', '--port', String(PYTHON_PORT)],
    {
      cwd: REPO_ENGINE,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    }
  )

  let opToken = ''
  let dataDir = ''
  let activeProfFile = ''
  let brTokenFile = ''

  await new Promise<void>((res, rej) => {
    pyProcess.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.startsWith('ENGINE_READY:')) {
          const parts = line.trim().split(':')
          opToken = parts[3]
          dataDir = parts[4]
          activeProfFile = parts[5]
          brTokenFile = parts[6]
          res()
        }
      }
    })
    pyProcess.on('error', rej)
    pyProcess.on('exit', (code) => {
      if (code !== 0) {
        rej(new Error(`Python process exited: ${code}`))
      }
    })
  })

  process.env.MANAGED_PORT = String(PYTHON_PORT)
  process.env.MANAGED_ACTIVE_PROFILE_PATH = activeProfFile
  process.env.MANAGED_BRIDGE_TOKEN_PATH = brTokenFile
  process.env.MANAGED_PROFILE = 'NORMAL'

  // Wait for HTTP
  for (let i = 0; i < 30; i++) {
    try {
      const p = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/csrf-token`)
      if (p.ok) {
        break
      }
    } catch {
      await wait(150)
    }
  }
  console.log('  --> Motor Python FastAPI: LISTO')

  // 3. Orca Desktop Runtime RPC Server
  console.log('[3/4] Iniciando Servidor RPC Orca Desktop en 127.0.0.1:6789...')
  const userDataPath = mkdtempSync(resolve(tmpdir(), 'orca-desktop-manual-'))
  const runtime = new OrcaRuntimeService(partialRuntimeStore(makeStore()))
  const server = new OrcaRuntimeRpcServer({
    runtime,
    userDataPath,
    enableWebSocket: true,
    pinnedBindHost: '127.0.0.1',
    wsPort: ORCA_RPC_PORT
  })
  await server.start()
  console.log('  --> Servidor RPC Orca Desktop: LISTO')

  // 4. Generate Pairing Offer
  console.log('[4/4] Generando oferta de pairing para Moto G20...')
  const desktopOffer = server.createPairingOffer({ address: '127.0.0.1', scope: 'mobile' })
  const parsedOffer = parsePairingCode(desktopOffer.pairingUrl)

  console.log('\n================================================================')
  console.log('                   HOST LISTO PARA EMPAREJAR                   ')
  console.log('================================================================')
  console.log(`URL de Pairing: ${desktopOffer.pairingUrl}`)
  if (parsedOffer?.code) {
    console.log(`Codigo de Pairing: ${parsedOffer.code}`)
  }
  console.log('================================================================\n')

  // Operator session for auto-approval
  let sessionCookie = ''
  let csrfToken = ''
  try {
    const unlockResp = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/auth/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: opToken })
    })
    const cookieHeader = unlockResp.headers.get('set-cookie') ?? ''
    const sessionMatch = /orchestrator_session=([^;]+)/.exec(cookieHeader)
    sessionCookie = sessionMatch ? `orchestrator_session=${sessionMatch[1]}` : ''
    const unlockData = (await unlockResp.json()) as { csrf_token: string }
    csrfToken = unlockData.csrf_token
  } catch (e) {
    console.warn('Error preparando sesion de operador:', e)
  }

  // Background watcher to auto-approve any registering device
  const approvedDevices = new Set<string>()
  const pollInterval = setInterval(async () => {
    if (!sessionCookie || !csrfToken) {
      return
    }
    try {
      const devListRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/devices`, {
        headers: { Cookie: sessionCookie }
      })
      if (!devListRes.ok) {
        return
      }
      const devList = (await devListRes.json()) as {
        devices?: { device_id: string; device_name: string; status: string }[]
      }
      for (const dev of devList.devices || []) {
        if (dev.status === 'PENDING_APPROVAL' && !approvedDevices.has(dev.device_id)) {
          approvedDevices.add(dev.device_id)
          console.log(
            `[AUTO-APPROVAL] Dispositivo pendiente detectado: ${dev.device_name} (${dev.device_id})`
          )
          console.log(`[AUTO-APPROVAL] Aprobando dispositivo como Operador de Windows...`)
          const appRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/approve`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken,
              Cookie: sessionCookie
            },
            body: JSON.stringify({ device_id: dev.device_id })
          })
          const appData = (await appRes.json()) as { ok: boolean; status: string }
          console.log(`[AUTO-APPROVAL] Estado de aprobacion: ${JSON.stringify(appData)}`)
        }
      }
    } catch {}
  }, 1000)

  // Keep alive until process termination
  const cleanup = async () => {
    clearInterval(pollInterval)
    console.log('\nCerrando host...')
    try {
      await server.stop()
    } catch {}
    try {
      pyProcess.kill()
    } catch {}
    try {
      rmSync(userDataPath, { recursive: true, force: true })
      if (dataDir) {
        rmSync(dataDir, { recursive: true, force: true })
      }
    } catch {}
    try {
      adbExec('reverse --remove tcp:6789')
    } catch {}
    process.exit(0)
  }

  process.on('SIGINT', () => void cleanup())
  process.on('SIGTERM', () => void cleanup())
}

void main()
