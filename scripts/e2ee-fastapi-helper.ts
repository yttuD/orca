import { execSync } from 'node:child_process'
import {
  computeFingerprintFromPublicKey,
  SecureTrustedHostStore
} from '../mobile/src/managed/trusted-host-store'

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

  return {
    deviceToken: regData.device.token,
    csrfToken,
    sessionCookie
  }
}

export async function testReplayRejection(
  port: number,
  auth: { deviceId: string; deviceToken: string; nonce: string; timestamp: number }
): Promise<boolean> {
  const res = await fetch(`http://127.0.0.1:${port}/api/managed/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Managed-Device-Id': auth.deviceId,
      'X-Managed-Nonce': auth.nonce,
      'X-Managed-Timestamp': String(auth.timestamp),
      Authorization: `Bearer ${auth.deviceToken}`
    },
    body: JSON.stringify({ method: 'managed.listProjects', params: {} })
  })
  const json = (await res.json()) as { ok: boolean }
  return !json.ok
}

export async function testCrossProfileRejection(port: number, token: string): Promise<boolean> {
  const res = await fetch(`http://127.0.0.1:${port}/api/managed/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Managed-Profile': 'STAGING_LOCAL',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ method: 'managed.listProjects', params: {} })
  })
  const json = (await res.json()) as { ok: boolean }
  return !json.ok
}

export async function verifyHostTrustPinning(): Promise<void> {
  const hostStore = new SecureTrustedHostStore()
  const testHostPk = 'MCowBQYDK2VwAyEAX5eM8j92rLq0v3Wk1y7Za8Zb3C2V5m7Pq1d8F4n0X2k='
  const validFingerprint = computeFingerprintFromPublicKey(testHostPk)

  const noRefRes = await hostStore.verifyAndPinHost('host-test-1', testHostPk)
  if (noRefRes.error !== 'INDEPENDENT_REFERENCE_REQUIRED') {
    throw new Error(`Expected INDEPENDENT_REFERENCE_REQUIRED, got: ${noRefRes.error}`)
  }

  const badRefRes = await hostStore.verifyAndPinHost('host-test-1', testHostPk, 'wrong-fingerprint')
  if (badRefRes.error !== 'INDEPENDENT_FINGERPRINT_MISMATCH') {
    throw new Error(`Expected INDEPENDENT_FINGERPRINT_MISMATCH, got: ${badRefRes.error}`)
  }

  const pinRes = await hostStore.verifyAndPinHost('host-test-1', testHostPk, validFingerprint)
  if (!pinRes.ok) {
    throw new Error(`Failed to pin valid host: ${pinRes.error}`)
  }

  const substRes = await hostStore.verifyAndPinHost(
    'host-test-1',
    'DIFFERENT_HOST_KEY_B64==',
    validFingerprint
  )
  if (substRes.error !== 'HOST_KEY_SUBSTITUTION_REJECTED') {
    throw new Error(`Expected HOST_KEY_SUBSTITUTION_REJECTED, got: ${substRes.error}`)
  }
}
