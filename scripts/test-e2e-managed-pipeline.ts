#!/usr/bin/env npx tsx
/**
 * Authentic ORCA-04D-R1 E2E Integration Pipeline Test:
 * Mobile Client -> Encrypted Tunnel -> Orca Desktop RPC Runtime -> callEngineRpc -> Python FastAPI -> SQLite Stores.
 * Zero mocks on callEngineRpc, zero mocks on Desktop adapter, zero mocks on FastAPI.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { readFileSync, rmSync } from 'node:fs'
import { WebSocketServer } from 'ws'
import nacl from 'tweetnacl'
import { EncryptedRpcManagedDataProvider } from '../mobile/src/managed/data-provider'
import type { MobileDeviceCredential } from '../mobile/src/managed/types'
import { RpcDispatcher } from '../src/main/runtime/rpc/dispatcher'
import { MANAGED_RPC_METHODS } from '../src/main/runtime/rpc/methods/managed'
import type { OrcaRuntimeService } from '../src/main/runtime/orca-runtime'
import { AuthenticE2eeMobileRpcClient, setupDesktopRpcServer } from './e2ee-test-client'
import type { RpcClient } from '../mobile/src/transport/rpc-client'

const PYTHON_PORT = 8765
const ORCA_RPC_PORT = 6789
const REPO_ENGINE = resolve(__dirname, '../../ORQUESTADOR-MASTER')

async function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

type PairingOfferData = {
  offer_id: string
  host_id: string
  host_fingerprint: string
  nonce: string
  issued_at: number
  host_signature: string
}

async function runAuthenticE2eTest(): Promise<void> {
  console.log('=== [ORCA-04D-R1] Starting Authentic E2E Integration Pipeline ===')

  console.log('[1/8] Spawning authentic Python FastAPI engine on 127.0.0.1:8765...')
  const pyProcess: ChildProcess = spawn(
    'python',
    ['scripts/start_e2e_engine.py', '--port', String(PYTHON_PORT)],
    {
      cwd: REPO_ENGINE,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    }
  )

  let offerData: PairingOfferData | null = null
  let dataDir = ''
  let opToken = ''

  await new Promise<void>((res, rej) => {
    pyProcess.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      for (const line of text.split('\n')) {
        if (line.startsWith('ENGINE_READY:')) {
          const parts = line.trim().split(':')
          opToken = parts[3]
          dataDir = parts.slice(4).join(':')
          const offerPath = resolve(dataDir, 'latest_offer.json')
          try {
            offerData = JSON.parse(readFileSync(offerPath, 'utf8'))
            console.log(`[Python Engine] Ready on port ${parts[1]}, offer: ${parts[2]}`)
            res()
          } catch (e) {
            rej(e)
          }
        }
      }
    })
    pyProcess.on('error', rej)
    pyProcess.on('exit', (code) => {
      if (code !== 0) {
        rej(new Error(`Python process exited prematurely with code ${code}`))
      }
    })
  })

  if (!offerData) {
    throw new Error('Failed to retrieve pairing offer from authentic engine')
  }

  console.log('[2/8] Initializing Orca Desktop runtime RPC server on 127.0.0.1:6789...')
  const desktopKeyPair = nacl.box.keyPair()
  const desktopPublicKeyB64 = Buffer.from(desktopKeyPair.publicKey).toString('base64')

  const runtimeMock = { getRuntimeId: () => 'orca-desktop-main-runtime' }
  const dispatcher = new RpcDispatcher({
    runtime: runtimeMock as unknown as OrcaRuntimeService,
    methods: MANAGED_RPC_METHODS
  })

  const wss = new WebSocketServer({ port: ORCA_RPC_PORT })
  setupDesktopRpcServer(wss, dispatcher, desktopKeyPair)

  try {
    console.log('[3/8] Waiting for FastAPI to accept HTTP connections on port 8765...')
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
    console.log('[FastAPI Engine] Accepting HTTP connections on 127.0.0.1:8765')

    console.log('Registering mobile device via /api/managed/mobile/register...')
    const deviceId = 'pixel-8-e2e'
    const validOffer: PairingOfferData = offerData
    const regResp = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offer_id: validOffer.offer_id,
        device_id: deviceId,
        device_name: 'Pixel 8 E2E Pro',
        client_nonce: 'cnonce-e2e-client-9876543210'
      })
    })

    const regData = (await regResp.json()) as {
      ok: boolean
      device: { status: string; token: string }
    }
    if (!regData.ok || regData.device.status !== 'PENDING_APPROVAL') {
      throw new Error(`Device registration unexpected: ${JSON.stringify(regData)}`)
    }
    const deviceToken = regData.device.token
    console.log(
      `[Mobile Device] Registered with status: ${regData.device.status} (Pending Operator Approval)`
    )

    console.log('[4/8] Connecting encrypted mobile transport (NaCl Curve25519) to Orca Desktop...')
    const credential: MobileDeviceCredential = {
      deviceId,
      deviceName: 'Pixel 8 E2E Pro',
      deviceToken,
      hostId: validOffer.host_id,
      hostAddress: `127.0.0.1:${ORCA_RPC_PORT}`,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      role: 'MOBILE_READONLY',
      revoked: false,
      nonce: 'nonce-init'
    }

    const client = new AuthenticE2eeMobileRpcClient(
      `ws://127.0.0.1:${ORCA_RPC_PORT}`,
      deviceToken,
      desktopPublicKeyB64
    )
    await client.connect()

    const provider = new EncryptedRpcManagedDataProvider(client as unknown as RpcClient, credential)
    console.log('[Transport] E2EE socket connected and authenticated with Orca Desktop')

    console.log('[5/8] Verification: Querying managed.listProjects BEFORE approval...')
    const preStatus = await provider.probeAuthentication()
    if (preStatus !== 'AUTH_REQUIRED') {
      throw new Error(`Expected AUTH_REQUIRED before operator approval, got: ${preStatus}`)
    }
    let preThrew = false
    try {
      await provider.listProjects()
    } catch {
      preThrew = true
    }
    if (!preThrew) {
      throw new Error('Expected listProjects to fail before operator approval')
    }
    console.log(
      '  --> PASS: Device correctly rejected with AUTH_REQUIRED prior to operator approval'
    )

    console.log(
      '[6/8] Operator explicitly unlocks session and approves device via /api/managed/mobile/approve...'
    )
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

    const appResp = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: sessionCookie
      },
      body: JSON.stringify({ device_id: deviceId })
    })
    const appData = (await appResp.json()) as { ok: boolean; status: string }
    if (!appData.ok || appData.status !== 'AUTHORIZED') {
      throw new Error(`Failed to approve device: ${JSON.stringify(appData)}`)
    }
    console.log(`[Operator] Device approved. Status: ${appData.status}`)

    console.log(
      '[7/8] Verification: Querying real ProjectStore and TaskStore through Orca tunnel...'
    )
    const postStatus = await provider.probeAuthentication()
    if (postStatus !== 'ONLINE') {
      throw new Error(`Expected ONLINE after operator approval, got: ${postStatus}`)
    }

    const projects = await provider.listProjects()
    if (!projects || projects.length === 0 || projects[0].name !== 'Authentic E2E Project') {
      throw new Error(
        `Expected real project 'Authentic E2E Project', got: ${JSON.stringify(projects)}`
      )
    }
    const realProjectId = projects[0].id
    console.log(`  --> PASS: Recovered authentic Project: "${projects[0].name}" (${realProjectId})`)

    const tasks = await provider.listTasks(realProjectId)
    if (!tasks || tasks.length === 0 || !tasks[0].id) {
      throw new Error(`Expected real tasks, got: ${JSON.stringify(tasks)}`)
    }
    const realTaskId = tasks[0].id
    console.log(`  --> PASS: Recovered authentic Task: "${tasks[0].title}" (${realTaskId})`)

    const evidence = await provider.getEvidence(realProjectId, realTaskId)
    if (!evidence) {
      throw new Error('Evidence was null')
    }
    if (
      evidence.provenance !== 'AUTHENTIC' ||
      !evidence.provenance_verified ||
      !evidence.commit_exists ||
      evidence.hash_status !== 'VERIFIED' ||
      evidence.certification_status !== 'CERTIFIED'
    ) {
      throw new Error(`Evidence integrity failed: ${JSON.stringify(evidence)}`)
    }
    console.log(
      `  --> PASS: Evidence certified authentic (Provenance: ${evidence.provenance}, Hash: ${evidence.hash_status}, Cert: ${evidence.certification_status})`
    )

    console.log(
      '[8/8] Verification: Operator revokes device and tunnel immediately fails closed...'
    )
    const revResp = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/managed/mobile/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: sessionCookie
      },
      body: JSON.stringify({ device_id: deviceId })
    })
    const revData = (await revResp.json()) as { ok: boolean; status: string }
    if (!revData.ok || revData.status !== 'REVOKED') {
      throw new Error(`Failed to revoke device: ${JSON.stringify(revData)}`)
    }
    console.log(`[Operator] Device revoked. Status: ${revData.status}`)

    let postRevThrew = false
    try {
      await provider.listProjects()
    } catch {
      postRevThrew = true
    }
    if (!postRevThrew) {
      throw new Error('Expected listProjects to fail immediately after operator revocation!')
    }

    const finalStatus = provider.getConnectionStatus()
    if (finalStatus !== 'AUTH_REQUIRED') {
      throw new Error(`Expected status AUTH_REQUIRED after revocation, got: ${finalStatus}`)
    }
    console.log('  --> PASS: Tunnel query immediately rejected with AUTH_REQUIRED upon revocation!')

    console.log('\n======================================================================')
    console.log('   FULL_E2E_PASS: AUTHENTIC PIPELINE (MOBILE -> DESKTOP -> PYTHON)    ')
    console.log('   All 8 verifications succeeded against real SQLite stores!           ')
    console.log('======================================================================\n')

    client.close()
  } finally {
    wss.close()
    pyProcess.kill('SIGTERM')
    if (dataDir) {
      try {
        rmSync(dataDir, { recursive: true, force: true })
      } catch {
        // cleanup
      }
    }
  }
}

runAuthenticE2eTest().catch((err) => {
  console.error('FATAL E2E ERROR:', err)
  process.exit(1)
})
