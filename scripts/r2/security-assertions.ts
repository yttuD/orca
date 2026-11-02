import { verifyHostFingerprint } from '../../mobile/src/managed/trusted-host-store'
import { execAdb } from './adb-controller'

export type SecurityAssertionResult = {
  name: string
  pass: boolean
  detail: string
}

export async function runPhone06SecurityAssertions(params: {
  baseUrl: string
  deviceToken: string
}): Promise<SecurityAssertionResult[]> {
  const results: SecurityAssertionResult[] = []

  // 1. HTTP 400 on invalid registration parameters (missing nonce / empty device)
  try {
    const res = await fetch(`${params.baseUrl}/api/managed/mobile/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: '', device_name: '', client_nonce: '' })
    })
    const is400 = res.status === 400
    results.push({
      name: 'PHONE-06:HTTP_400_ON_INVALID_PARAMS',
      pass: is400,
      detail: `Status=${res.status} (expected 400)`
    })
  } catch (err) {
    results.push({
      name: 'PHONE-06:HTTP_400_ON_INVALID_PARAMS',
      pass: false,
      detail: String(err)
    })
  }

  // 2. Mobile device token cannot administer devices (read-only / privilege escalation guard)
  try {
    const res = await fetch(`${params.baseUrl}/api/managed/mobile/devices`, {
      headers: { Authorization: `Bearer ${params.deviceToken}` }
    })
    const is401 = res.status === 401
    results.push({
      name: 'PHONE-06:MOBILE_TOKEN_CANNOT_ADMIN_DEVICES',
      pass: is401,
      detail: `Status=${res.status} (expected 401)`
    })
  } catch (err) {
    results.push({
      name: 'PHONE-06:MOBILE_TOKEN_CANNOT_ADMIN_DEVICES',
      pass: false,
      detail: String(err)
    })
  }

  // 3. Independent Fingerprint Verification asserts mismatch fails closed
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

  // 4. Independent Fingerprint Verification asserts empty reference rejected
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

  return results
}

export async function runPhone07RecoveryAssertions(params: {
  port: number
  deviceCountCheck: () => Promise<number>
  initialCount: number
}): Promise<SecurityAssertionResult[]> {
  const results: SecurityAssertionResult[] = []

  // 1. Interrupt ADB reverse tunnel to test disconnection
  try {
    execAdb(['reverse', '--remove', `tcp:${params.port}`])
    results.push({
      name: 'PHONE-07:TUNNEL_DISCONNECTED',
      pass: true,
      detail: `Port reverse tcp:${params.port} removed`
    })
  } catch (err) {
    results.push({
      name: 'PHONE-07:TUNNEL_DISCONNECTED',
      pass: false,
      detail: String(err)
    })
  }

  // Brief pause
  await new Promise((r) => setTimeout(r, 2000))

  // 2. Restore ADB reverse tunnel
  try {
    execAdb(['reverse', `tcp:${params.port}`, `tcp:${params.port}`])
    results.push({
      name: 'PHONE-07:TUNNEL_RESTORED',
      pass: true,
      detail: `Port reverse tcp:${params.port} restored`
    })
  } catch (err) {
    results.push({
      name: 'PHONE-07:TUNNEL_RESTORED',
      pass: false,
      detail: String(err)
    })
  }

  // 3. Assert no duplicate devices were created
  try {
    const finalCount = await params.deviceCountCheck()
    const noDuplicates = finalCount === params.initialCount
    results.push({
      name: 'PHONE-07:NO_DUPLICATE_DEVICES',
      pass: noDuplicates,
      detail: `Initial=${params.initialCount}, Final=${finalCount}`
    })
  } catch (err) {
    results.push({
      name: 'PHONE-07:NO_DUPLICATE_DEVICES',
      pass: false,
      detail: String(err)
    })
  }

  return results
}
