#!/usr/bin/env npx tsx
/**
 * Authentic ORCA-04E E2E Runtime Integration Pipeline Test:
 * Mobile Client -> Encrypted Tunnel -> Orca Desktop RPC Runtime -> callEngineRpc -> Python FastAPI -> SQLite Stores.
 * Negative tests (replay, cross-profile, spoofing, revocation) traverse the REAL path.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { EncryptedRpcManagedDataProvider } from '../mobile/src/managed/data-provider'
import type { MobileDeviceCredential } from '../mobile/src/managed/types'
import {
  saveStoredCredential,
  computeFingerprintFromPublicKey
} from '../mobile/src/managed/trusted-host-store'
import { OrcaRuntimeService } from '../src/main/runtime/orca-runtime'
import { OrcaRuntimeRpcServer } from '../src/main/runtime/runtime-rpc'
import { makeStore } from '../src/main/runtime/runtime-rpc-worktree-store-fixtures'
import { partialRuntimeStore } from '../src/main/runtime/runtime-store-partial-fixture'
import { parsePairingCode } from '../src/shared/pairing'
import { AuthenticE2eeMobileRpcClient } from './e2ee-test-client'
import {
  checkLoopbackOnly,
  approveDeviceAsOperator,
  verifyRealHostTrustPinning,
  verifyRealQueries,
  verifyRealSecurityBoundaries
} from './e2ee-fastapi-helper'
import type { RpcClient } from '../mobile/src/transport/rpc-client'

const PYTHON_PORT = 8765
const ORCA_RPC_PORT = 6789
const REPO_ENGINE = resolve(__dirname, '../../ORQUESTADOR-MASTER')

async function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function runAuthenticE2eTest(): Promise<void> {
  console.log('=== [ORCA-04E] Starting Authentic E2E Runtime Integration Pipeline ===')
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
        for (const line of chunk.toString().split('\n')) {
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
          rej(new Error(`Python process exited prematurely: ${code}`))
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
      throw new Error(`Socket not loopback: ${socketCheck.details}`)
    }
    console.log(`  --> PASS [LOOPBACK_ONLY_PASS]: Strictly bound to 127.0.0.1`)

    console.log('[3/7] Generating pairing offer & verifying independent host key pinning...')
    const desktopOffer = server.createPairingOffer({ address: '127.0.0.1', scope: 'mobile' })
    const parsedOffer = parsePairingCode(desktopOffer.pairingUrl)
    if (!parsedOffer) {
      throw new Error('Failed to parse Orca Desktop pairing code')
    }

    const realHostPubKey = server.getE2EEPublicKey()!
    const outOfBandFingerprint = computeFingerprintFromPublicKey(realHostPubKey)
    await verifyRealHostTrustPinning('orca-desktop-main', realHostPubKey, outOfBandFingerprint)
    console.log(
      '  --> PASS [HOST_TRUST_PASS]: Fail-closed store & independent fingerprint pinning verified'
    )

    console.log('[4/7] Connecting mobile client to Orca Desktop Runtime via E2EE WebSocket...')
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

    client = new AuthenticE2eeMobileRpcClient(
      parsedOffer.endpoint,
      parsedOffer.deviceToken,
      parsedOffer.publicKeyB64
    )
    await client.connect()

    console.log(
      '[5/7] Registering device via Desktop RPC (managed.registerDevice) & auto-approval...'
    )
    const hostIdentity = (await client.request('managed.getHostIdentity', {})) as {
      fingerprint?: string
      host_fingerprint?: string
      host_id?: string
    }
    const hostFp = hostIdentity?.fingerprint || hostIdentity?.host_fingerprint
    if (!hostFp) {
      throw new Error('Host identity missing fingerprint')
    }

    const deviceId = parsedOffer.pairedDeviceId || 'pixel-8-e2e'

    // Negative check: Mismatched fingerprint is rejected
    let mismatchRejected = false
    try {
      await client.request('managed.registerDevice', {
        offerId,
        deviceId,
        deviceName: 'Pixel 8 E2E Pro',
        clientNonce: `cnonce-${Date.now()}`,
        confirmedFingerprint: 'invalid-fingerprint-ref'
      })
    } catch {
      mismatchRejected = true
    }
    if (!mismatchRejected) {
      throw new Error('Expected FINGERPRINT_MISMATCH rejection on bad reference')
    }
    console.log('  --> PASS [FINGERPRINT_VERIFICATION_PASS]: Explicit host fingerprint checked')

    const regRes = (await client.request('managed.registerDevice', {
      offerId,
      deviceId,
      deviceName: 'Pixel 8 E2E Pro',
      clientNonce: `cnonce-${Date.now()}`,
      confirmedFingerprint: hostFp
    })) as { ok: boolean; credential: MobileDeviceCredential }

    if (!regRes.ok || !regRes.credential) {
      throw new Error(`Device registration via RPC failed: ${JSON.stringify(regRes)}`)
    }
    const credential = regRes.credential
    await saveStoredCredential(credential)

    const provider = new EncryptedRpcManagedDataProvider(client as unknown as RpcClient, credential)
    const initialProbe = await provider.probeAuthentication()
    if (initialProbe !== 'PENDING_APPROVAL') {
      throw new Error(`Expected PENDING_APPROVAL, got: ${initialProbe}`)
    }
    console.log(
      '  --> PASS [PENDING_APPROVAL_VERIFIED]: Mobile state is PENDING_APPROVAL before approval'
    )

    const fastApiAuth = await approveDeviceAsOperator(PYTHON_PORT, deviceId, opToken)
    console.log('  --> PASS [WINDOWS_OPERATOR_APPROVAL]: Device approved by Windows operator')

    const approvedProbe = await provider.probeAuthentication()
    if (approvedProbe !== 'ONLINE') {
      throw new Error(`Expected ONLINE, got: ${approvedProbe}`)
    }
    console.log(
      '  --> PASS [AUTOMATIC_TRANSITION_PASS]: PENDING_APPROVAL -> AUTHORIZED -> ONLINE confirmed'
    )

    console.log('[6/7] Querying real stores through Orca Desktop Runtime...')
    const authPayload = {
      deviceId: credential.deviceId,
      deviceToken: credential.deviceToken,
      nonce: `req-nonce-${Date.now()}-rev`,
      timestamp: Math.floor(Date.now() / 1000)
    }
    await verifyRealQueries(provider, client, authPayload)
    console.log(
      '  --> PASS [SEEDED_TEST_DATA]: Explicitly marked as SEEDED_TEST_DATA and UNCERTIFIED'
    )
    console.log('  --> PASS [DESKTOP_RUNTIME_E2E_PASS]: Real queries succeeded across pipeline')

    console.log(
      '[7/7] Verifying Security Boundaries via REAL Path (Mobile RPC -> Desktop -> FastAPI)...'
    )
    await verifyRealSecurityBoundaries({
      client,
      server,
      credential,
      authPayload,
      pythonPort: PYTHON_PORT,
      csrfToken: fastApiAuth.csrfToken,
      sessionCookie: fastApiAuth.sessionCookie
    })

    client.close()
    const reconnectClient = new AuthenticE2eeMobileRpcClient(
      parsedOffer.endpoint,
      parsedOffer.deviceToken,
      parsedOffer.publicKeyB64
    )
    await reconnectClient.connect()
    const postRuntimeRevokeRes = await reconnectClient.sendRequest('managed.listProjects', {})
    if (postRuntimeRevokeRes.ok) {
      throw new Error('Expected request to fail after Orca runtime revocation')
    }
    reconnectClient.close()

    console.log(
      '  --> PASS [MOBILE_AUTHORIZATION_PASS]: Replay, spoofing, cross-profile & dual revocation verified'
    )
    console.log('\n=== ORCA-04E SUCCESS: Real Orca Desktop Runtime E2E Pipeline Verified ===\n')
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
