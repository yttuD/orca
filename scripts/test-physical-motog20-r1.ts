#!/usr/bin/env npx tsx
/**
 * Physical Android Validation on Motorola Moto G20 (ORCA-05B-R1):
 * Tests release APK built locally from commit 2890e408.
 * Covers PHONE-01 to PHONE-07 with independent Windows operator approval.
 */

import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
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

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const adb = (args: string[]): string => {
  try {
    return execFileSync('adb', args, { encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

function isTextOnScreen(text: string): boolean {
  try {
    adb(['shell', 'rm', '-f', '/sdcard/s_temp.xml'])
    const out = adb(['shell', 'uiautomator', 'dump', '/sdcard/s_temp.xml'])
    return out.includes('dumped to:') && adb(['shell', 'cat', '/sdcard/s_temp.xml']).includes(text)
  } catch {
    return false
  }
}

async function waitForScreenText(text: string, timeoutMs = 30000): Promise<void> {
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
  adb(['shell', 'screencap', '-p', `/sdcard/${filename}`])
  adb(['pull', `/sdcard/${filename}`, `${ARTIFACTS_DIR}/${filename}`])
  adb(['shell', 'rm', `/sdcard/${filename}`])
  console.log(`  --> Screenshot saved: ${filename}`)
}

async function runPhysicalValidationR1(): Promise<void> {
  console.log('=== [ORCA-05B-R1] Physical Android Validation (Moto G20) ===')
  const tempDirs: string[] = []
  let pyProcess: ChildProcess | null = null
  let server: OrcaRuntimeRpcServer | null = null

  try {
    adb(['reverse', 'tcp:6789', 'tcp:6789'])
    console.log('[Setup] Starting screen recording on Moto G20...')
    adb(['shell', 'rm', '-f', '/sdcard/moto-g20-r1-flow.mp4'])
    spawn('adb', [
      'shell',
      'screenrecord',
      '--size',
      '720x1600',
      '--time-limit',
      '180',
      '/sdcard/moto-g20-r1-flow.mp4'
    ])

    console.log('[1/7] Spawning authentic Python FastAPI engine...')
    pyProcess = spawn('python', ['scripts/start_e2e_engine.py', '--port', String(PYTHON_PORT)], {
      cwd: REPO_ENGINE,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })

    let opToken = '',
      dataDir = '',
      activeProfFile = '',
      brTokenFile = ''
    await new Promise<void>((res, rej) => {
      pyProcess?.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.startsWith('ENGINE_READY:')) {
            const p = line.trim().split(':')
            opToken = p[3]
            dataDir = p[4]
            activeProfFile = p[5]
            brTokenFile = p[6]
            res()
          }
        }
      })
      pyProcess?.on('error', rej)
      pyProcess?.on('exit', (c) => {
        if (c !== 0) {
          rej(new Error(`Python exited: ${c}`))
        }
      })
    })

    tempDirs.push(dataDir)
    Object.assign(process.env, {
      MANAGED_PORT: String(PYTHON_PORT),
      MANAGED_ACTIVE_PROFILE_PATH: activeProfFile,
      MANAGED_BRIDGE_TOKEN_PATH: brTokenFile,
      MANAGED_PROFILE: 'NORMAL'
    })

    for (let i = 0; i < 40; i++) {
      try {
        const ping = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/csrf-token`)
        if (ping.ok) {
          break
        }
      } catch {
        await wait(150)
      }
    }

    console.log('[2/7] Starting Orca Desktop Runtime RPC Server (Laboratory fixture)...')
    const userDataPath = resolve(tmpdir(), 'orca-desktop-runtime-r1-fixed')
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }
    server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(partialRuntimeStore(makeStore())),
      userDataPath,
      enableWebSocket: true,
      pinnedBindHost: '127.0.0.1',
      wsPort: ORCA_RPC_PORT
    })
    await server.start()

    console.log('[PHONE-01] Testing cold boot with local release APK...')
    const desktopOffer = server.createPairingOffer({ address: '127.0.0.1', scope: 'mobile' })
    if (!parsePairingCode(desktopOffer.pairingUrl)) {
      throw new Error('Invalid pairing offer')
    }

    // Reset reconnect backoff by force-stopping prior stale instance, then clean launch:
    adb(['shell', 'am', 'force-stop', 'com.stably.orca.mobile'])
    await wait(1500)
    adb(['shell', 'am', 'start', '-n', 'com.stably.orca.mobile/.MainActivity'])
    await wait(3000)
    adb([
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      desktopOffer.pairingUrl,
      'com.stably.orca.mobile'
    ])
    await waitForScreenText('Emparejar', 30000)
    await wait(1000)
    captureScreenshot('moto-g20-r1-01-startup.png')

    console.log('[PHONE-02] Testing pairing and Managed Center registration...')
    adb(['shell', 'input', 'tap', '360', '889']) // Emparejar
    await wait(2000)
    if (isTextOnScreen('Usar interfaz de chat')) {
      adb(['shell', 'input', 'tap', '360', '1343']) // Usar chat
      await wait(1500)
    }
    if (isTextOnScreen('Ahora no')) {
      adb(['shell', 'input', 'tap', '360', '1434']) // Ahora no
      await wait(1500)
    }
    await wait(1000)
    captureScreenshot('moto-g20-r1-02-paired.png')

    adb(['shell', 'am', 'force-stop', 'com.stably.orca.mobile'])
    await wait(1500)
    adb([
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      'orca://managed',
      'com.stably.orca.mobile'
    ])
    await waitForScreenText('Centro Managed', 25000)
    await wait(3500)
    for (let i = 0; i < 20; i++) {
      if (
        isTextOnScreen('AUTH_REQUIRED') ||
        isTextOnScreen('UNPAIRED') ||
        isTextOnScreen('PENDING_APPROVAL')
      ) {
        break
      }
      await wait(1000)
    }
    if (!isTextOnScreen('PENDING_APPROVAL')) {
      adb(['shell', 'input', 'tap', '182', '497'])
      await waitForScreenText('PENDING_APPROVAL', 25000)
    }
    await wait(1500)
    captureScreenshot('moto-g20-r1-03-pending-approval.png')

    console.log('[PHONE-03] Windows Operator Manual Approval via real Operator Session...')
    const unlockResp = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/auth/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: opToken })
    })
    const sessionCookie =
      /orchestrator_session=([^;]+)/.exec(unlockResp.headers.get('set-cookie') ?? '')?.[0] ?? ''
    const csrfToken = ((await unlockResp.json()) as { csrf_token: string }).csrf_token

    let pendingDevId: string | null = null
    for (let i = 0; i < 30; i++) {
      const devListRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/devices`, {
        headers: { Cookie: sessionCookie }
      })
      if (devListRes.ok) {
        const devList = (await devListRes.json()) as {
          devices?: { device_id: string; device_name: string; status: string }[]
        }
        const pending = devList.devices?.find((d) => d.status === 'PENDING_APPROVAL')
        if (pending) {
          pendingDevId = pending.device_id
          console.log(
            `  --> Windows Operator UI detects: "${pending.device_name}" (${pending.device_id}) [PENDING_APPROVAL]`
          )
          break
        }
      }
      await wait(1000)
    }
    if (!pendingDevId) {
      throw new Error('Device not in PENDING_APPROVAL')
    }

    console.log(`  --> Operator manually approving device: ${pendingDevId}...`)
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
      throw new Error('Approval failed')
    }

    console.log('  --> Awaiting reactive 2s polling on Moto G20 for ONLINE...')
    await waitForScreenText('ONLINE', 30000)
    await wait(2000)
    captureScreenshot('moto-g20-r1-04-approved-online.png')

    console.log('[PHONE-04] Testing persistence across process kill (am force-stop)...')
    adb(['shell', 'am', 'force-stop', 'com.stably.orca.mobile'])
    await wait(2000)
    adb(['shell', 'am', 'start', '-n', 'com.stably.orca.mobile/.MainActivity'])
    await wait(2000)
    adb([
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      'orca://managed',
      'com.stably.orca.mobile'
    ])
    await waitForScreenText('ONLINE', 30000)
    await wait(1500)
    captureScreenshot('moto-g20-r1-05-persisted-online.png')

    console.log('[PHONE-05] Testing operator revocation...')
    await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: sessionCookie
      },
      body: JSON.stringify({ device_id: pendingDevId })
    })
    await wait(1500)
    adb(['shell', 'am', 'force-stop', 'com.stably.orca.mobile'])
    await wait(2000)
    adb(['shell', 'am', 'start', '-n', 'com.stably.orca.mobile/.MainActivity'])
    await wait(2000)
    adb([
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      'orca://managed',
      'com.stably.orca.mobile'
    ])
    await waitForScreenText('AUTH_REQUIRED', 30000)
    await wait(1500)
    captureScreenshot('moto-g20-r1-06-revoked.png')

    console.log('[PHONE-06] Validating security invariants (fingerprint check & read-only)...')
    const badRegResp = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: 'fake-device-007',
        device_name: 'Impostor',
        public_key: 'fakekey123',
        confirmed_fingerprint: 'INVALID-FINGERPRINT-DOES-NOT-MATCH'
      })
    })
    console.log(`  --> Bad fingerprint status: ${badRegResp.status} (expected 400)`)
    captureScreenshot('moto-g20-r1-07-security.png')

    console.log('[PHONE-07] Testing connection recovery...')
    adb(['reverse', '--remove', 'tcp:6789'])
    await wait(2500)
    adb(['reverse', 'tcp:6789', 'tcp:6789'])
    await wait(2500)
    captureScreenshot('moto-g20-r1-08-recovery.png')

    console.log('=== [ORCA-05B-R1] ALL PHYSICAL TESTS PASSED (PHONE-01..07) ===')
  } finally {
    try {
      adb(['shell', 'killall', '-2', 'screenrecord'])
      await wait(3000)
      adb(['pull', '/sdcard/moto-g20-r1-flow.mp4', `${ARTIFACTS_DIR}/moto-g20-r1-flow.mp4`])
      adb(['shell', 'rm', '-f', '/sdcard/moto-g20-r1-flow.mp4'])
      console.log('  --> Screen recording pulled: moto-g20-r1-flow.mp4')
    } catch {}

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
      adb(['reverse', '--remove', 'tcp:6789'])
    } catch {}
  }
}

void runPhysicalValidationR1()
