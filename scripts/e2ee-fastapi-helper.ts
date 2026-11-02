import { execSync } from 'node:child_process'
import {
  createMemoryStorageDriver,
  SecureTrustedHostStore,
  setTestSecureStorageDriver
} from '../mobile/src/managed/trusted-host-store'
import type { AuthenticE2eeMobileRpcClient } from './e2ee-test-client'
import type { EncryptedRpcManagedDataProvider } from '../mobile/src/managed/data-provider'
import type { MobileDeviceCredential } from '../mobile/src/managed/types'
import type { OrcaRuntimeRpcServer } from '../src/main/runtime/runtime-rpc'

export type FastApiPairingResult = {
  deviceToken: string
  csrfToken: string
  sessionCookie: string
}

export function checkLoopbackOnly(port: number): { isLoopbackOnly: boolean; details: string } {
  try {
    const cmd = `powershell -NoProfile -Command "Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq ${port} } | Select-Object -Property LocalAddress, LocalPort | ConvertTo-Json"`
    const out = execSync(cmd, { encoding: 'utf-8' }).trim()
    if (!out) {
      return { isLoopbackOnly: false, details: 'No listening connection found' }
    }
    const parsed = JSON.parse(out) as
      | { LocalAddress: string; LocalPort: number }
      | { LocalAddress: string; LocalPort: number }[]
    const records = Array.isArray(parsed) ? parsed : [parsed]
    const nonLoopback = records.filter(
      (r) => r.LocalAddress !== '127.0.0.1' && r.LocalAddress !== '::1'
    )
    if (nonLoopback.length > 0) {
      return {
        isLoopbackOnly: false,
        details: `Exposed on non-loopback addresses: ${JSON.stringify(nonLoopback)}`
      }
    }
    return {
      isLoopbackOnly: true,
      details: records.map((r) => `${r.LocalAddress}:${r.LocalPort}`).join(', ')
    }
  } catch (err) {
    return { isLoopbackOnly: false, details: String(err) }
  }
}

export async function performFastApiPairing(
  port: number,
  offerId: string,
  deviceId: string,
  opToken: string
): Promise<FastApiPairingResult> {
  const regResp = await fetch(`http://127.0.0.1:${port}/api/managed/mobile/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      offer_id: offerId,
      device_id: deviceId,
      device_name: 'Pixel 8 E2E Pro',
      client_nonce: `cnonce-${Date.now()}`
    })
  })
  const regData = (await regResp.json()) as {
    ok: boolean
    device: { status: string; token: string }
  }
  if (!regData.ok || regData.device.status !== 'PENDING_APPROVAL') {
    throw new Error(`Device registration unexpected: ${JSON.stringify(regData)}`)
  }

  const unlockResp = await fetch(`http://127.0.0.1:${port}/api/auth/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: opToken })
  })
  const cookieHeader = unlockResp.headers.get('set-cookie') ?? ''
  const sessionMatch = /orchestrator_session=([^;]+)/.exec(cookieHeader)
  const sessionCookie = sessionMatch ? `orchestrator_session=${sessionMatch[1]}` : ''
  const unlockData = (await unlockResp.json()) as { csrf_token: string }
  const csrfToken = unlockData.csrf_token

  const appResp = await fetch(`http://127.0.0.1:${port}/api/managed/mobile/approve`, {
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

  return { deviceToken: regData.device.token, csrfToken, sessionCookie }
}

export async function verifyRealHostTrustPinning(
  hostId: string,
  realHostPublicKey: string,
  outOfBandFingerprint: string
): Promise<void> {
  setTestSecureStorageDriver(null)
  const unconfiguredStore = new SecureTrustedHostStore()
  const unconfiguredPin = await unconfiguredStore.verifyAndPinHost(
    hostId,
    realHostPublicKey,
    outOfBandFingerprint
  )
  if (unconfiguredPin.ok || unconfiguredPin.error !== 'STORAGE_PERSISTENCE_FAILED') {
    throw new Error(`Expected STORAGE_PERSISTENCE_FAILED, got: ${unconfiguredPin.error}`)
  }

  setTestSecureStorageDriver(createMemoryStorageDriver())
  const hostStore = new SecureTrustedHostStore()

  const noRefRes = await hostStore.verifyAndPinHost(hostId, realHostPublicKey)
  if (noRefRes.error !== 'INDEPENDENT_REFERENCE_REQUIRED') {
    throw new Error(`Expected INDEPENDENT_REFERENCE_REQUIRED, got: ${noRefRes.error}`)
  }

  const badRefRes = await hostStore.verifyAndPinHost(hostId, realHostPublicKey, 'wrong-fingerprint')
  if (badRefRes.error !== 'INDEPENDENT_FINGERPRINT_MISMATCH') {
    throw new Error(`Expected INDEPENDENT_FINGERPRINT_MISMATCH, got: ${badRefRes.error}`)
  }

  const pinRes = await hostStore.verifyAndPinHost(hostId, realHostPublicKey, outOfBandFingerprint)
  if (!pinRes.ok) {
    throw new Error(`Failed to pin real host with independent fingerprint: ${pinRes.error}`)
  }

  const substRes = await hostStore.verifyAndPinHost(
    hostId,
    'DIFFERENT_HOST_KEY_B64==',
    outOfBandFingerprint
  )
  if (substRes.error !== 'HOST_KEY_SUBSTITUTION_REJECTED') {
    throw new Error(`Expected HOST_KEY_SUBSTITUTION_REJECTED, got: ${substRes.error}`)
  }
}

export async function verifyRealQueries(
  provider: EncryptedRpcManagedDataProvider,
  client: AuthenticE2eeMobileRpcClient,
  authPayload: Record<string, unknown>
): Promise<{ realProjectId: string; realTaskId: string }> {
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
    throw new Error(`Seeded test data must be synthetic & uncertified: ${JSON.stringify(evidence)}`)
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

  return { realProjectId, realTaskId }
}

export async function verifyRealSecurityBoundaries(params: {
  client: AuthenticE2eeMobileRpcClient
  server: OrcaRuntimeRpcServer
  credential: MobileDeviceCredential
  authPayload: Record<string, unknown>
  pythonPort: number
  csrfToken: string
  sessionCookie: string
}): Promise<void> {
  const { client, server, credential, authPayload, pythonPort, csrfToken, sessionCookie } = params

  const spoofRes = await client.sendRequest('managed.listProjects', {
    _auth: { ...authPayload, deviceId: 'spoofed-attacker-device-id' }
  })
  if (spoofRes.ok || !JSON.stringify(spoofRes.error).includes('DEVICE_IDENTITY_SPOOF_REJECTED')) {
    throw new Error(`Expected spoofing to be rejected: ${JSON.stringify(spoofRes)}`)
  }

  const incompleteRes = await client.sendRequest('managed.listProjects', {
    _auth: { deviceId: credential.deviceId, deviceToken: credential.deviceToken }
  })
  if (
    incompleteRes.ok ||
    !JSON.stringify(incompleteRes.error).includes('INCOMPLETE_AUTHENTICATION_METADATA')
  ) {
    throw new Error(`Expected incomplete metadata rejection: ${JSON.stringify(incompleteRes)}`)
  }

  const freshNonce = `req-nonce-${Date.now()}-real-fresh1`
  const firstRes = await client.sendRequest('managed.listProjects', {
    _auth: { ...authPayload, nonce: freshNonce, timestamp: Math.floor(Date.now() / 1000) }
  })
  if (!firstRes.ok) {
    throw new Error('Initial query for replay test failed')
  }
  const replayRes = await client.sendRequest('managed.listProjects', {
    _auth: { ...authPayload, nonce: freshNonce, timestamp: Math.floor(Date.now() / 1000) }
  })
  if (replayRes.ok) {
    throw new Error('Expected replay attack to be rejected over real client')
  }

  const crossRes = await client.sendRequest('managed.listProjects', {
    _auth: {
      ...authPayload,
      nonce: `req-nonce-${Date.now()}-real-cross`,
      timestamp: Math.floor(Date.now() / 1000),
      profile: 'STAGING_LOCAL'
    }
  })
  if (crossRes.ok) {
    throw new Error('Expected cross-profile access to be rejected over real client')
  }

  const revokeResp = await fetch(`http://127.0.0.1:${pythonPort}/api/managed/mobile/revoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      Cookie: sessionCookie
    },
    body: JSON.stringify({ device_id: credential.deviceId })
  })
  const revokeData = (await revokeResp.json()) as { ok: boolean; status: string }
  if (!revokeData.ok || revokeData.status !== 'REVOKED') {
    throw new Error('Failed to revoke device in Python MobileDeviceRegistry')
  }

  const postEngineRevokeRes = await client.sendRequest('managed.listProjects', {
    _auth: { ...authPayload, nonce: `req-nonce-${Date.now()}-post-eng-rev` }
  })
  if (postEngineRevokeRes.ok) {
    throw new Error('Expected request to fail after Python engine revocation')
  }

  server.revokeRuntimeAccess(credential.deviceId)
}
