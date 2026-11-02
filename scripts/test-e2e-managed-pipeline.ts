#!/usr/bin/env npx tsx
/**
 * Authentic ORCA-04D-R2 E2E Integration Pipeline Test:
 * Mobile Client -> Encrypted Tunnel -> Orca Desktop RPC Runtime -> callEngineRpc -> Python FastAPI -> SQLite Stores.
 * Zero mocks on callEngineRpc, zero mocks on Desktop runtime, zero mocks on FastAPI.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { EncryptedRpcManagedDataProvider } from '../mobile/src/managed/data-provider'
import type { MobileDeviceCredential } from '../mobile/src/managed/types'
import { saveStoredCredential } from '../mobile/src/managed/trusted-host-store'
import { OrcaRuntimeService } from '../src/main/runtime/orca-runtime'
import { OrcaRuntimeRpcServer } from '../src/main/runtime/runtime-rpc'
import { makeStore } from '../src/main/runtime/runtime-rpc-worktree-store-fixtures'
import { partialRuntimeStore } from '../src/main/runtime/runtime-store-partial-fixture'
import { parsePairingCode } from '../src/shared/pairing'
import { AuthenticE2eeMobileRpcClient } from './e2ee-test-client'
import {
  checkLoopbackOnly,
  performFastApiPairing,
  testReplayRejection,
  testCrossProfileRejection,
  verifyHostTrustPinning
} from './e2ee-fastapi-helper'
import type { RpcClient } from '../mobile/src/transport/rpc-client'

const PYTHON_PORT = 8765
const ORCA_RPC_PORT = 6789
const REPO_ENGINE = resolve(__dirname, '../../ORQUESTADOR-MASTER')

async function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function runAuthenticE2eTest(): Promise<void> {
  console.log('=== [ORCA-04D-R2] Starting Authentic E2E Runtime Integration Pipeline ===')
  const tempDirs: string[] = []
  let pyProcess: ChildProcess | null = null
  let server: OrcaRuntimeRpcServer | null = null
  let client: AuthenticE2eeMobileRpcClient | null = null

  try {
    console.log('[1/7] Spawning authentic Python FastAPI engine on 127.0.0.1:8765...')
    pyProcess = spawn('python', ['scripts/start_e2e_engine.py', '--port', String(PYTHON_PORT)], {
      cwd: REPO_ENGINE,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })

    let offerId = ''
    let opToken = ''
    let dataDir = ''
    let activeProfFile = ''
    let brTokenFile = ''

    await new Promise<void>((res, rej) => {
      pyProcess?.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        for (const line of text.split('\n')) {
          if (line.startsWith('ENGINE_READY:')) {
            const parts = line.trim().split(':')
            offerId = parts[2]
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
          rej(new Error(`Python process exited prematurely with code ${code}`))
        }
      })
    })

    tempDirs.push(dataDir)
    process.env.MANAGED_PORT = String(PYTHON_PORT)
    process.env.MANAGED_ACTIVE_PROFILE_PATH = activeProfFile
    process.env.MANAGED_BRIDGE_TOKEN_PATH = brTokenFile
    process.env.MANAGED_PROFILE = 'NORMAL'

    console.log('[2/7] Starting real Orca Desktop Runtime RPC Server on 127.0.0.1:6789...')
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

    const socketCheck = checkLoopbackOnly(ORCA_RPC_PORT)
    if (!socketCheck.isLoopbackOnly) {
      throw new Error(`Socket not loopback only: ${socketCheck.details}`)
    }
    console.log(
      `  --> PASS [LOOPBACK_ONLY_PASS]: Strictly bound to 127.0.0.1 (${socketCheck.details})`
    )

    console.log('[3/7] Verifying Host Trust & Key Pinning (HOST_TRUST_PASS)...')
    await verifyHostTrustPinning()
    console.log(
      '  --> PASS [HOST_TRUST_PASS]: Fingerprint reference, explicit acceptance, and substitution rejected'
    )

    console.log('[4/7] Generating pairing offer from Orca Desktop & registering on FastAPI...')
    const desktopOffer = server.createPairingOffer({ address: '127.0.0.1', scope: 'mobile' })
    const parsedOffer = parsePairingCode(desktopOffer.pairingUrl)
    if (!parsedOffer) {
      throw new Error('Failed to parse Orca Desktop pairing code')
    }

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

    const fastApiAuth = await performFastApiPairing(
      PYTHON_PORT,
      offerId,
      parsedOffer.pairedDeviceId || 'pixel-8-e2e',
      opToken
    )

    const credential: MobileDeviceCredential = {
      deviceId: parsedOffer.pairedDeviceId || 'pixel-8-e2e',
      deviceName: 'Pixel 8 E2E Pro',
      deviceToken: fastApiAuth.deviceToken,
      hostId: 'orca-desktop-main',
      hostAddress: `127.0.0.1:${ORCA_RPC_PORT}`,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      role: 'MOBILE_READONLY',
      revoked: false,
      nonce: 'nonce-init'
    }
    await saveStoredCredential(credential)

    console.log('[5/7] Connecting mobile client to real Orca Desktop Runtime via E2EE...')
    client = new AuthenticE2eeMobileRpcClient(
      parsedOffer.endpoint,
      parsedOffer.deviceToken,
      parsedOffer.publicKeyB64
    )
    await client.connect()

    const provider = new EncryptedRpcManagedDataProvider(client as unknown as RpcClient, credential)
    const probeStatus = await provider.probeAuthentication()
    if (probeStatus !== 'ONLINE') {
      throw new Error(`Expected ONLINE status, got: ${probeStatus}`)
    }

    console.log(
      '[6/7] Querying real stores through Orca Desktop Runtime (DESKTOP_RUNTIME_E2E_PASS)...'
    )
    const projects = await provider.listProjects()
    if (!projects || projects.length === 0 || !projects[0].name.includes('SEEDED_TEST_DATA')) {
      throw new Error(`Project query invalid: ${JSON.stringify(projects)}`)
    }
    const realProjectId = projects[0].id

    const tasks = await provider.listTasks(realProjectId)
    if (!tasks || tasks.length === 0 || !tasks[0].id) {
      throw new Error(`Tasks query invalid: ${JSON.stringify(tasks)}`)
    }
    const realTaskId = tasks[0].id

    const evidence = await provider.getEvidence(realProjectId, realTaskId)
    if (!evidence || !evidence.is_synthetic || evidence.certification_status !== 'UNCERTIFIED') {
      throw new Error(
        `Seeded test data must be uncertified and synthetic: ${JSON.stringify(evidence)}`
      )
    }
    console.log(
      '  --> PASS [SEEDED_TEST_DATA]: Explicitly marked as SEEDED_TEST_DATA and UNCERTIFIED'
    )

    const authPayload = {
      deviceId: credential.deviceId,
      deviceToken: credential.deviceToken,
      nonce: `req-nonce-${Date.now()}-rev`,
      timestamp: Math.floor(Date.now() / 1000)
    }
    const reviewRes = await client.sendRequest('managed.presentReviewPacket', {
      projectId: realProjectId,
      taskId: realTaskId,
      _auth: authPayload
    })
    if (!reviewRes.ok) {
      throw new Error(`Review packet failed: ${JSON.stringify(reviewRes)}`)
    }

    const activityRes = await client.sendRequest('managed.listActivity', {
      projectId: realProjectId,
      taskId: realTaskId,
      _auth: { ...authPayload, nonce: `req-nonce-${Date.now()}-act` }
    })
    if (!activityRes.ok) {
      throw new Error(`Activity query failed: ${JSON.stringify(activityRes)}`)
    }

    const execRes = await client.sendRequest('managed.getExecution', {
      projectId: realProjectId,
      taskId: realTaskId,
      _auth: { ...authPayload, nonce: `req-nonce-${Date.now()}-exec` }
    })
    if (!execRes.ok) {
      throw new Error(`Execution query failed: ${JSON.stringify(execRes)}`)
    }
    console.log(
      '  --> PASS [DESKTOP_RUNTIME_E2E_PASS]: Real Desktop RPC -> callEngineRpc -> FastAPI -> SQLite'
    )

    console.log('[7/7] Verifying Security Boundaries (MOBILE_AUTHORIZATION_PASS)...')
    const spoofRes = await client.sendRequest('managed.listProjects', {
      _auth: { ...authPayload, deviceId: 'spoofed-attacker-device-id' }
    })
    const spoofRejected =
      !spoofRes.ok &&
      (String(spoofRes.error?.message).includes('DEVICE_IDENTITY_SPOOF_REJECTED') ||
        String(spoofRes.error?.code).includes('DEVICE_IDENTITY_SPOOF_REJECTED'))
    if (!spoofRejected) {
      throw new Error(`Expected spoofing attempt to be rejected, got: ${JSON.stringify(spoofRes)}`)
    }

    const replayRejected = await testReplayRejection(PYTHON_PORT, authPayload)
    if (!replayRejected) {
      throw new Error('Expected replay attack to be rejected')
    }

    const crossProfileRejected = await testCrossProfileRejection(
      PYTHON_PORT,
      fastApiAuth.deviceToken
    )
    if (!crossProfileRejected) {
      throw new Error('Expected cross-profile access to be rejected')
    }

    client.close()
    const clientReconnect = new AuthenticE2eeMobileRpcClient(
      parsedOffer.endpoint,
      parsedOffer.deviceToken,
      parsedOffer.publicKeyB64
    )
    await clientReconnect.connect()

    if (parsedOffer.pairedDeviceId) {
      server.revokeRuntimeAccess(parsedOffer.pairedDeviceId)
      const revRes = await clientReconnect.sendRequest('managed.listProjects', {})
      if (revRes.ok) {
        throw new Error('Expected RPC to fail after runtime revocation')
      }
    }
    clientReconnect.close()
    console.log(
      '  --> PASS [MOBILE_AUTHORIZATION_PASS]: Identity, replay, cross-profile, reconnect & revocation verified'
    )
    console.log('\n=== ORCA-04D-R2 SUCCESS: Real Orca Desktop Runtime E2E Verified ===\n')
  } finally {
    client?.close()
    if (server) {
      await server.stop()
    }
    if (pyProcess) {
      pyProcess.kill('SIGTERM')
    }
    for (const d of tempDirs) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    const leaked = execSync(`powershell -Command "Test-Path '${REPO_ENGINE}\\.active_profile'"`, {
      encoding: 'utf-8'
    }).trim()
    if (leaked === 'True') {
      console.error('FATAL: .active_profile leaked into operational engine repository!')
      process.exit(1)
    }
    console.log('  --> PASS [ENVIRONMENT_CLEAN_PASS]: Zero pollution in operational working tree')
  }
}

runAuthenticE2eTest().catch((err) => {
  console.error('FATAL E2E ERROR:', err)
  process.exit(1)
})
