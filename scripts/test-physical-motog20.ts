#!/usr/bin/env npx tsx
/**
 * Physical Android Validation on Motorola Moto G20 (ORCA-05B):
 * Real Android APK -> ADB Reverse Tunnel -> Real Orca Desktop Runtime RPC Server -> Python FastAPI -> SQLite.
 * Captures real screen evidence for every lifecycle stage.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process'
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
const ARTIFACTS_DIR =
  'C:/Users/carlo/.gemini/antigravity-cli/brain/ea2e1aed-cf97-4128-a59c-c2d77666ad1f'

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function adbExec(cmd: string): string {
  return execSync(`adb ${cmd}`, { encoding: 'utf-8' }).trim()
}

function isTextOnScreen(text: string): boolean {
  try {
    adbExec('shell rm -f /sdcard/s_temp.xml')
    const out = adbExec('shell uiautomator dump /sdcard/s_temp.xml')
    if (!out.includes('dumped to:')) {
      return false
    }
    return adbExec('shell cat /sdcard/s_temp.xml').includes(text)
  } catch {
    return false
  }
}

async function waitForScreenText(text: string, timeoutMs = 25000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (isTextOnScreen(text)) {
      console.log(`  --> UI detected: "${text}"`)
      return
    }
    await wait(1000)
  }
  throw new Error(`Timed out waiting for UI element: "${text}"`)
}

function captureScreenshot(filename: string): void {
  adbExec(`shell screencap -p /sdcard/${filename}`)
  adbExec(`pull /sdcard/${filename} ${ARTIFACTS_DIR}/${filename}`)
  adbExec(`shell rm /sdcard/${filename}`)
  console.log(`  --> Screenshot saved: ${filename}`)
}

async function runPhysicalValidation(): Promise<void> {
  console.log('=== [ORCA-05B] Physical Android Validation on Motorola Moto G20 ===')
  const tempDirs: string[] = []
  let pyProcess: ChildProcess | null = null
  let server: OrcaRuntimeRpcServer | null = null

  try {
    // 0. Set up ADB reverse port forwarding
    console.log('[1/9] Setting up ADB reverse tunnel for port 6789...')
    adbExec('reverse tcp:6789 tcp:6789')
    console.log('  --> ADB reverse: host-20 tcp:6789 tcp:6789 ACTIVE')

    // 1. Spawn authentic Python FastAPI engine
    console.log('[2/9] Spawning authentic Python FastAPI engine on 127.0.0.1:8765...')
    pyProcess = spawn('python', ['scripts/start_e2e_engine.py', '--port', String(PYTHON_PORT)], {
      cwd: REPO_ENGINE,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })

    let _offerId = ''
    let opToken = ''
    let dataDir = ''
    let activeProfFile = ''
    let brTokenFile = ''

    await new Promise<void>((res, rej) => {
      pyProcess?.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.startsWith('ENGINE_READY:')) {
            const parts = line.trim().split(':')
            _offerId = parts[2]
            opToken = parts[3]
            dataDir = parts[4]
            activeProfFile = parts[5]
            brTokenFile = parts[6]
            res()
          }
        }
      })
      pyProcess?.on('error', rej)
      pyProcess?.on('exit', (code) => {
        if (code !== 0) {
          rej(new Error(`Python process exited prematurely: ${code}`))
        }
      })
    })

    tempDirs.push(dataDir)
    process.env.MANAGED_PORT = String(PYTHON_PORT)
    process.env.MANAGED_ACTIVE_PROFILE_PATH = activeProfFile
    process.env.MANAGED_BRIDGE_TOKEN_PATH = brTokenFile
    process.env.MANAGED_PROFILE = 'NORMAL'

    let httpReady = false
    for (let i = 0; i < 40; i++) {
      try {
        const ping = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/csrf-token`)
        if (ping.ok) {
          httpReady = true
          break
        }
      } catch {
        await wait(150)
      }
    }
    if (!httpReady) {
      throw new Error('FastAPI engine did not start in time')
    }

    // 2. Start Orca Desktop Runtime RPC Server
    console.log('[3/9] Starting Orca Desktop Runtime RPC Server on 127.0.0.1:6789...')
    const userDataPath = mkdtempSync(resolve(tmpdir(), 'orca-desktop-runtime-'))
    tempDirs.push(userDataPath)

    const runtime = new OrcaRuntimeService(partialRuntimeStore(makeStore()))
    server = new OrcaRuntimeRpcServer({
      runtime,
      userDataPath,
      enableWebSocket: true,
      pinnedBindHost: '127.0.0.1',
      wsPort: ORCA_RPC_PORT
    })
    await server.start()

    // 3. Generate authentic pairing offer
    console.log('[4/9] Generating pairing offer for Moto G20...')
    const desktopOffer = server.createPairingOffer({ address: '127.0.0.1', scope: 'mobile' })
    const parsedOffer = parsePairingCode(desktopOffer.pairingUrl)
    if (!parsedOffer) {
      throw new Error('Failed to parse desktop pairing offer')
    }
    console.log(`  --> Pairing URL generated: ${desktopOffer.pairingUrl.slice(0, 40)}...`)

    // 4. Deliver pairing intent to Moto G20
    console.log('[5/9] Delivering pairing intent to Moto G20...')
    adbExec('shell am force-stop com.stably.orca.mobile')
    await wait(1500)
    adbExec(
      `shell am start -a android.intent.action.VIEW -d "${desktopOffer.pairingUrl}" com.stably.orca.mobile`
    )
    await waitForScreenText('Emparejar', 30000)
    await wait(1000)
    captureScreenshot('moto-g20-01-pair-confirm.png')

    // Tap "Emparejar" button on pair-confirm screen (center width 360, y 889)
    console.log('  --> Tapping "Emparejar" button on Moto G20 (360, 889)...')
    adbExec('shell input tap 360 889')
    await waitForScreenText('Usar interfaz de chat', 30000)
    await wait(1000)
    captureScreenshot('moto-g20-02-paired.png')

    // Complete Onboarding: Step 1 tap "Usar interfaz de chat" (360, 1343), Step 2 tap "Ahora no" (360, 1434)
    console.log('  --> Completing onboarding step 1: "Usar interfaz de chat" (360, 1343)...')
    adbExec('shell input tap 360 1343')
    await waitForScreenText('Ahora no', 20000)
    await wait(1000)
    console.log('  --> Completing onboarding step 2: "Ahora no" (360, 1434)...')
    adbExec('shell input tap 360 1434')
    await wait(2500)

    // 5. Navigate to Managed Center on Moto G20
    console.log('[6/9] Navigating to Managed Center on Moto G20...')
    adbExec(
      'shell am start -a android.intent.action.VIEW -d "orca://managed" com.stably.orca.mobile'
    )
    await waitForScreenText('Emparejar Centro Managed', 25000)
    console.log('  --> Waiting 8s for WebSocket client to reach connected state...')
    await wait(8000)
    captureScreenshot('moto-g20-03-managed-unpaired.png')

    // Tap "Emparejar Centro Managed" button (x 200, y 497)
    console.log('  --> Tapping "Emparejar Centro Managed" button on Moto G20 (200, 497)...')
    adbExec('shell input tap 200 497')
    await wait(4000)
    captureScreenshot('moto-g20-04-pending-approval.png')

    // 6. Find registered device and approve it as Windows Operator
    console.log('[7/9] Polling Python registry for pending Moto G20 device...')
    const unlockResp = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/auth/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: opToken })
    })
    const cookieHeader = unlockResp.headers.get('set-cookie') ?? ''
    const sessionMatch = /orchestrator_session=([^;]+)/.exec(cookieHeader)
    const sessionCookie = sessionMatch ? `orchestrator_session=${sessionMatch[1]}` : ''
    const unlockData = (await unlockResp.json()) as { csrf_token: string }
    const csrfToken = unlockData.csrf_token

    let pendingDevId: string | null = null
    for (let i = 0; i < 30; i++) {
      const devListRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/devices`, {
        headers: { Cookie: sessionCookie }
      })
      if (devListRes.ok) {
        const devList = (await devListRes.json()) as {
          devices?: { device_id: string; status: string }[]
        }
        const pending = devList.devices?.find((d) => d.status === 'PENDING_APPROVAL')
        if (pending) {
          pendingDevId = pending.device_id
          break
        }
      }
      await wait(1000)
    }

    if (!pendingDevId) {
      throw new Error('Device did not register in Python within timeout')
    }
    console.log(`  --> Found pending device: ${pendingDevId}`)

    const appResp = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: sessionCookie
      },
      body: JSON.stringify({ device_id: pendingDevId })
    })
    const appData = (await appResp.json()) as { ok: boolean; status: string }
    if (!appData.ok || appData.status !== 'AUTHORIZED') {
      throw new Error(`Failed to approve device: ${JSON.stringify(appData)}`)
    }
    console.log(`  --> Windows Operator approved device: ${pendingDevId}`)

    // Wait for reactive polling (2s interval) on Moto G20 to detect approval and transition to ONLINE
    console.log('  --> Waiting for reactive 2s polling on Moto G20 to detect approval...')
    await waitForScreenText('ONLINE', 25000)
    await wait(1000)
    captureScreenshot('moto-g20-05-online.png')

    // 7. Test persistence: kill app, re-open, verify session recovery from SecureStore
    console.log('[8/9] Testing persistence and recovery on Moto G20...')
    adbExec('shell am force-stop com.stably.orca.mobile')
    await wait(2000)
    adbExec(
      'shell am start -a android.intent.action.VIEW -d "orca://managed" com.stably.orca.mobile'
    )
    await waitForScreenText('ONLINE', 25000)
    await wait(1000)
    captureScreenshot('moto-g20-06-persisted-online.png')

    // 8. Test revocation: operator revokes device, verify phone transitions to AUTH_REQUIRED
    console.log('[9/9] Testing operator revocation on Moto G20...')
    const revRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: sessionCookie
      },
      body: JSON.stringify({ device_id: pendingDevId })
    })
    console.log(`  --> Device revocation API status: ${revRes.status}`)
    await waitForScreenText('AUTH_REQUIRED', 25000)
    await wait(1000)
    captureScreenshot('moto-g20-07-revoked.png')

    console.log('=== ORCA-05B SUCCESS: Physical Android Moto G20 Validation Complete ===')
  } finally {
    if (server) {
      try {
        await server.stop()
      } catch {}
    }
    if (pyProcess) {
      try {
        pyProcess.kill()
      } catch {}
    }
    for (const d of tempDirs) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {}
    }
    try {
      adbExec('reverse --remove tcp:6789')
    } catch {}
  }
}

void runPhysicalValidation()
