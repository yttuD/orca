#!/usr/bin/env npx tsx
/**
 * Physical Android Validation on Motorola Moto G20 (ORCA-05B-R3):
 * Strict audit closure: separated UI automated vs human approval,
 * legitimate authorized mobile credential testing in PHONE-06,
 * reconnection while still authorized in PHONE-07, and <300 lines ratchet.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { OrcaRuntimeService } from '../src/main/runtime/orca-runtime'
import { OrcaRuntimeRpcServer } from '../src/main/runtime/runtime-rpc'
import { makeStore } from '../src/main/runtime/runtime-rpc-worktree-store-fixtures'
import { partialRuntimeStore } from '../src/main/runtime/runtime-store-partial-fixture'
import { parsePairingCode } from '../src/shared/pairing'
import {
  execAdb,
  isScreenTextPresent,
  waitForScreenText,
  captureScreen,
  startScreenRecording,
  stopScreenRecording
} from './r2/adb-controller'
import { executeWindowsOperatorApproval } from './r2/windows-operator-panel'
import { runPhone06SecurityAssertions } from './r2/security-assertions'
import { runPhone07RecoveryAssertions } from './r2/recovery-assertions'

const PYTHON_PORT = 8765
const ORCA_RPC_PORT = 6789
const REPO_ENGINE = resolve(__dirname, '../../ORQUESTADOR-MASTER')
const ARTIFACTS_DIR =
  'C:/Users/carlo/.gemini/antigravity-cli/brain/ea2e1aed-cf97-4128-a59c-c2d77666ad1f'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function openManagedCenter(fingerprint: string): Promise<void> {
  execAdb(['shell', 'am', 'force-stop', 'com.stably.orca.mobile'])
  await wait(1500)
  execAdb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    `orca://managed?expectedFingerprint=${fingerprint}`,
    'com.stably.orca.mobile'
  ])
}

async function runPhysicalValidationR3(): Promise<void> {
  console.log('=== [ORCA-05B-R3] Starting Physical Android Validation (Moto G20) ===')
  const tempDirs: string[] = []
  let pyProcess: ChildProcess | null = null
  let server: OrcaRuntimeRpcServer | null = null
  let recordProcess: ChildProcess | null = null

  try {
    execAdb(['reverse', 'tcp:6789', 'tcp:6789'])
    console.log('[Setup] Starting continuous screen recording on Moto G20...')
    recordProcess = startScreenRecording()

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
          rej(new Error(`Python exited with code ${c}`))
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

    const hostIdentRes = await fetch(
      `http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/host-identity`
    )
    const hostIdent = (await hostIdentRes.json()) as {
      host_fingerprint: string
      host_public_key: string
    }
    const expectedFingerprint = hostIdent.host_fingerprint
    console.log(`[Host Identity] Fingerprint=${expectedFingerprint}`)

    console.log('[2/7] Starting Orca Desktop Runtime RPC Server (Laboratory fixture)...')
    const userDataPath = resolve(tmpdir(), 'orca-desktop-runtime-r3')
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

    execAdb(['shell', 'am', 'force-stop', 'com.stably.orca.mobile'])
    await wait(1500)
    execAdb(['shell', 'am', 'start', '-n', 'com.stably.orca.mobile/.MainActivity'])
    await wait(3000)
    execAdb([
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
    captureScreen('moto-g20-r3-01-startup.png', ARTIFACTS_DIR)

    console.log('[PHONE-02] Testing pairing with independent fingerprint validation...')
    execAdb(['shell', 'input', 'tap', '360', '889'])
    await wait(2000)
    if (isScreenTextPresent('Usar interfaz de chat')) {
      execAdb(['shell', 'input', 'tap', '360', '1343'])
      await wait(1500)
    }
    if (isScreenTextPresent('Ahora no')) {
      execAdb(['shell', 'input', 'tap', '360', '1434'])
      await wait(1500)
    }
    await wait(1000)
    captureScreen('moto-g20-r3-02-paired.png', ARTIFACTS_DIR)

    await openManagedCenter(expectedFingerprint)
    await waitForScreenText('Centro Managed', 25000)
    await wait(3000)
    for (let i = 0; i < 20; i++) {
      if (
        isScreenTextPresent('AUTH_REQUIRED') ||
        isScreenTextPresent('UNPAIRED') ||
        isScreenTextPresent('PENDING_APPROVAL')
      ) {
        break
      }
      await wait(1000)
    }
    if (!isScreenTextPresent('PENDING_APPROVAL')) {
      execAdb(['shell', 'input', 'tap', '182', '497'])
      await waitForScreenText('PENDING_APPROVAL', 25000)
    }
    await wait(1500)
    captureScreen('moto-g20-r3-03-pending-approval.png', ARTIFACTS_DIR)

    console.log('[PHONE-03] Windows Operator UI Approval (UI_AUTOMATED vs HUMAN)...')
    const opApprovalResult = executeWindowsOperatorApproval({
      port: PYTHON_PORT,
      token: opToken,
      outputDir: ARTIFACTS_DIR
    })
    console.log(
      `  --> UI_AUTOMATED_PASS: ${opApprovalResult.ok ? 'PASS' : 'FAIL'} (${opApprovalResult.event})`
    )
    console.log(
      '  --> HUMAN_APPROVAL_PASS: NOT_RUN (Automated audit run without physical operator click)'
    )
    if (!opApprovalResult.ok) {
      throw new Error(`Operator approval failed: ${opApprovalResult.event}`)
    }

    console.log('  --> Awaiting reactive 2s polling on Moto G20 for ONLINE state...')
    await waitForScreenText('ONLINE', 30000)
    await wait(2000)
    captureScreen('moto-g20-r3-04-approved-online.png', ARTIFACTS_DIR)

    console.log('[PHONE-04] Testing persistence across process kill (am force-stop)...')
    await openManagedCenter(expectedFingerprint)
    await waitForScreenText('ONLINE', 30000)
    await wait(1500)
    captureScreen('moto-g20-r3-05-persisted-online.png', ARTIFACTS_DIR)

    // Authenticate operator session to inspect devices and issue legitimate lab credential
    const unlockResp = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/auth/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: opToken })
    })
    const sessionCookie =
      /orchestrator_session=([^;]+)/.exec(unlockResp.headers.get('set-cookie') ?? '')?.[0] ?? ''
    const csrfToken = ((await unlockResp.json()) as { csrf_token: string }).csrf_token

    const devListRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/devices`, {
      headers: { Cookie: sessionCookie }
    })
    const devList = (await devListRes.json()) as {
      devices: { device_id: string; status: string }[]
    }
    const authorizedDev = devList.devices.find((d) => d.status === 'AUTHORIZED')
    if (!authorizedDev) {
      throw new Error('Authorized device not found')
    }

    // Register and approve a legitimate lab credential for privilege testing
    const offerRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/offer`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken, Cookie: sessionCookie }
    })
    const offerData = (await offerRes.json()) as { offer: { offer_id: string } }
    const regRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offer_id: offerData.offer.offer_id,
        device_id: 'motog20-lab-device-sec',
        device_name: 'Motorola Moto G20 (Lab Auth)',
        client_nonce: `cnonce-${Date.now()}-sec-1234`
      })
    })
    const regJson = (await regRes.json()) as { device: { token: string } }
    const authorizedLabToken = regJson.device.token
    await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: sessionCookie
      },
      body: JSON.stringify({ device_id: 'motog20-lab-device-sec' })
    })

    console.log('[PHONE-07] Running recovery assertions on STILL-AUTHORIZED device...')
    const p7Results = await runPhone07RecoveryAssertions({
      port: ORCA_RPC_PORT,
      baseUrl: `http://127.0.0.1:${PYTHON_PORT}`,
      authorizedToken: authorizedLabToken,
      deviceCountCheck: async () => {
        const res = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/devices`, {
          headers: { Cookie: sessionCookie }
        })
        const data = (await res.json()) as { devices: unknown[] }
        return data.devices.length
      },
      initialCount: devList.devices.length + 1,
      waitForOnlineScreen: async (timeoutMs: number) => {
        await waitForScreenText('ONLINE', timeoutMs)
      }
    })
    for (const r of p7Results) {
      console.log(`  --> ${r.name}: ${r.pass ? 'PASS' : 'FAIL'} (${r.detail})`)
      if (!r.pass) {
        throw new Error(`Recovery assertion failed: ${r.name}`)
      }
    }
    captureScreen('moto-g20-r3-08-recovery.png', ARTIFACTS_DIR)

    console.log('[PHONE-06] Running strengthened security assertions with legitimate token...')
    const p6Results = await runPhone06SecurityAssertions({
      baseUrl: `http://127.0.0.1:${PYTHON_PORT}`,
      authorizedToken: authorizedLabToken
    })
    for (const r of p6Results) {
      console.log(`  --> ${r.name}: ${r.pass ? 'PASS' : 'FAIL'} (${r.detail})`)
      if (!r.pass) {
        throw new Error(`Security assertion failed: ${r.name}`)
      }
    }
    captureScreen('moto-g20-r3-07-security.png', ARTIFACTS_DIR)

    console.log('[PHONE-05] Testing operator revocation after all online tests...')
    await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: sessionCookie
      },
      body: JSON.stringify({ device_id: authorizedDev.device_id })
    })
    await wait(1500)
    await openManagedCenter(expectedFingerprint)
    await waitForScreenText('AUTH_REQUIRED', 30000)
    await wait(1500)
    captureScreen('moto-g20-r3-06-revoked.png', ARTIFACTS_DIR)

    console.log('[Logcat] Capturing redacted logcat for audit bundle...')
    try {
      const rawLogcat = execAdb(['logcat', '-d', '-t', '500'], { allowFail: true })
      const redacted = rawLogcat.replace(/Bearer\s+[A-Za-z0-9_-]+/g, 'Bearer [REDACTED]')
      writeFileSync(`${ARTIFACTS_DIR}/moto-g20-r3-logcat.txt`, redacted, 'utf-8')
      console.log('  --> Logcat saved to artifacts/moto-g20-r3-logcat.txt')
    } catch {}

    console.log('=== [ORCA-05B-R3] ALL PHYSICAL AND SECURITY TESTS PASSED (PHONE-01..07) ===')
  } finally {
    if (recordProcess) {
      await stopScreenRecording(recordProcess, `${ARTIFACTS_DIR}/moto-g20-r3-flow.mp4`)
    }
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
      execAdb(['reverse', '--remove', 'tcp:6789'], { allowFail: true })
    } catch {}
  }
}

void runPhysicalValidationR3()
