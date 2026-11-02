import {
  verifyHostFingerprint,
  SecureTrustedHostStore
} from '../../mobile/src/managed/trusted-host-store'

export type SecurityAssertionResult = {
  name: string
  pass: boolean
  detail: string
}

export async function runPhone06SecurityAssertions(params: {
  baseUrl: string
  authorizedToken: string
  deviceId?: string
}): Promise<SecurityAssertionResult[]> {
  const results: SecurityAssertionResult[] = []
  const devId = params.deviceId ?? 'motog20-lab-device-sec'

  // 1. Authorized mobile token CAN perform read-only RPC (managed.listProjects)
  try {
    const now = Math.floor(Date.now() / 1000)
    const res = await fetch(`${params.baseUrl}/api/managed/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.authorizedToken}`,
        'X-Managed-Device-Id': devId,
        'X-Managed-Nonce': `nonce-sec-read-${Date.now()}`,
        'X-Managed-Timestamp': String(now)
      },
      body: JSON.stringify({
        request_id: 'req-sec-read-1',
        method: 'managed.listProjects',
        protocol: { name: 'managed', major: 1, minor: 0 },
        caller: { surface: 'mobile' },
        params: {}
      })
    })
    const data = (await res.json()) as { ok?: boolean }
    results.push({
      name: 'PHONE-06:AUTH_TOKEN_READ_ALLOWED',
      pass: res.status === 200 && data.ok === true,
      detail: `Status=${res.status}, ok=${data.ok}`
    })
  } catch (err) {
    results.push({ name: 'PHONE-06:AUTH_TOKEN_READ_ALLOWED', pass: false, detail: String(err) })
  }

  // 2. Authorized mobile token CANNOT administer devices (privilege escalation blocked -> HTTP 401)
  try {
    const res = await fetch(`${params.baseUrl}/api/managed/mobile/devices`, {
      headers: {
        Authorization: `Bearer ${params.authorizedToken}`,
        'X-Managed-Device-Id': devId
      }
    })
    results.push({
      name: 'PHONE-06:AUTH_TOKEN_CANNOT_ADMIN_DEVICES',
      pass: res.status === 401,
      detail: `Status=${res.status} (expected 401)`
    })
  } catch (err) {
    results.push({
      name: 'PHONE-06:AUTH_TOKEN_CANNOT_ADMIN_DEVICES',
      pass: false,
      detail: String(err)
    })
  }

  // 3. Authorized mobile token CANNOT approve devices (HTTP 401)
  try {
    const res = await fetch(`${params.baseUrl}/api/managed/mobile/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.authorizedToken}`,
        'X-Managed-Device-Id': devId
      },
      body: JSON.stringify({ device_id: 'dev-spoofed' })
    })
    results.push({
      name: 'PHONE-06:AUTH_TOKEN_CANNOT_APPROVE_DEVICES',
      pass: res.status === 401,
      detail: `Status=${res.status} (expected 401)`
    })
  } catch (err) {
    results.push({
      name: 'PHONE-06:AUTH_TOKEN_CANNOT_APPROVE_DEVICES',
      pass: false,
      detail: String(err)
    })
  }

  // 4. Invalid mobile token fails authentication
  try {
    const res = await fetch(`${params.baseUrl}/api/managed/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mdt_invalid_unauthorized_token_hex',
        'X-Managed-Device-Id': devId,
        'X-Managed-Nonce': `nonce-sec-bad-${Date.now()}`,
        'X-Managed-Timestamp': String(Math.floor(Date.now() / 1000))
      },
      body: JSON.stringify({
        request_id: 'req-sec-bad-token',
        method: 'managed.listProjects',
        protocol: { name: 'managed', major: 1, minor: 0 },
        caller: { surface: 'mobile' },
        params: {}
      })
    })
    const data = (await res.json()) as { ok?: boolean; error_message?: string }
    const rejected = data.ok === false || (data.error_message?.includes('AUTH_REQUIRED') ?? false)
    results.push({
      name: 'PHONE-06:INVALID_TOKEN_REJECTED',
      pass: rejected,
      detail: `ok=${data.ok}, error_message=${data.error_message}`
    })
  } catch (err) {
    results.push({ name: 'PHONE-06:INVALID_TOKEN_REJECTED', pass: false, detail: String(err) })
  }

  // 5. HTTP 400 on invalid registration parameters (missing nonce / empty device)
  try {
    const res = await fetch(`${params.baseUrl}/api/managed/mobile/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: '', device_name: '', client_nonce: '' })
    })
    results.push({
      name: 'PHONE-06:HTTP_400_ON_INVALID_PARAMS',
      pass: res.status === 400,
      detail: `Status=${res.status} (expected 400)`
    })
  } catch (err) {
    results.push({ name: 'PHONE-06:HTTP_400_ON_INVALID_PARAMS', pass: false, detail: String(err) })
  }

  // 6. Independent Fingerprint Verification asserts mismatch fails closed
  try {
    const fakeKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    const mismatchRes = verifyHostFingerprint('06-phbw06AOjlRic', '99-fakeFingerprnt', fakeKey)
    results.push({
      name: 'PHONE-06:FINGERPRINT_MISMATCH_REJECTED',
      pass: !mismatchRes.ok && mismatchRes.reason === 'FINGERPRINT_MISMATCH',
      detail: `ok=${mismatchRes.ok}, reason=${mismatchRes.reason}`
    })
  } catch (err) {
    results.push({
      name: 'PHONE-06:FINGERPRINT_MISMATCH_REJECTED',
      pass: false,
      detail: String(err)
    })
  }

  // 7. Independent Fingerprint Verification asserts empty reference rejected
  try {
    const emptyRefRes = verifyHostFingerprint('06-phbw06AOjlRic', '')
    results.push({
      name: 'PHONE-06:EMPTY_FINGERPRINT_REF_REJECTED',
      pass: !emptyRefRes.ok && emptyRefRes.reason === 'MISSING_INDEPENDENT_REFERENCE',
      detail: `ok=${emptyRefRes.ok}, reason=${emptyRefRes.reason}`
    })
  } catch (err) {
    results.push({
      name: 'PHONE-06:EMPTY_FINGERPRINT_REF_REJECTED',
      pass: false,
      detail: String(err)
    })
  }

  // 8. Key substitution rejected by SecureTrustedHostStore
  try {
    const store = new SecureTrustedHostStore()
    const origKey = 'KMsCWIv+fW3YU4ywFIr+r66+dczkegsvhEA2OKbvJnk='
    const alienKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    await store.verifyAndPinHost('pinned-test', origKey, '06-phbw06AOjlRic')
    const sub = await store.verifyAndPinHost('pinned-test', alienKey)
    results.push({
      name: 'PHONE-06:KEY_SUBSTITUTION_REJECTED',
      pass: !sub.ok && sub.error === 'HOST_KEY_SUBSTITUTION_REJECTED',
      detail: `ok=${sub.ok}, error=${sub.error}`
    })
  } catch (err) {
    results.push({ name: 'PHONE-06:KEY_SUBSTITUTION_REJECTED', pass: false, detail: String(err) })
  }

  return results
}
