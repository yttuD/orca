import { execAdb } from './adb-controller'
import type { SecurityAssertionResult } from './security-assertions'

export async function runPhone07RecoveryAssertions(params: {
  port: number
  baseUrl: string
  authorizedToken: string
  deviceCountCheck: () => Promise<number>
  initialCount: number
  waitForOnlineScreen: (timeoutMs: number) => Promise<void>
}): Promise<SecurityAssertionResult[]> {
  const results: SecurityAssertionResult[] = []

  // 1. Verify initial authenticated state is ONLINE before disruption
  try {
    const res = await fetch(`${params.baseUrl}/api/managed/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.authorizedToken}`
      },
      body: JSON.stringify({
        request_id: 'req-rec-probe-1',
        method: 'managed.listProjects',
        protocol: { name: 'managed', major: 1, minor: 0 },
        caller: { surface: 'mobile' },
        params: {}
      })
    })
    results.push({
      name: 'PHONE-07:INITIAL_ONLINE_CONFIRMED',
      pass: res.status === 200,
      detail: `Status=${res.status}`
    })
  } catch (err) {
    results.push({ name: 'PHONE-07:INITIAL_ONLINE_CONFIRMED', pass: false, detail: String(err) })
  }

  // 2. Disconnect tunnel to simulate network drop
  try {
    execAdb(['reverse', '--remove', `tcp:${params.port}`])
    results.push({
      name: 'PHONE-07:TUNNEL_DISCONNECTED',
      pass: true,
      detail: `Port reverse tcp:${params.port} removed`
    })
  } catch (err) {
    results.push({ name: 'PHONE-07:TUNNEL_DISCONNECTED', pass: false, detail: String(err) })
  }

  await new Promise((r) => setTimeout(r, 2000))

  // 3. Restore reverse tunnel
  try {
    execAdb(['reverse', `tcp:${params.port}`, `tcp:${params.port}`])
    results.push({
      name: 'PHONE-07:TUNNEL_RESTORED',
      pass: true,
      detail: `Port reverse tcp:${params.port} restored`
    })
  } catch (err) {
    results.push({ name: 'PHONE-07:TUNNEL_RESTORED', pass: false, detail: String(err) })
  }

  // 4. Assert physical device screen recovers to ONLINE within bounded timeout (20s)
  try {
    await params.waitForOnlineScreen(20000)
    results.push({
      name: 'PHONE-07:SCREEN_RECOVERED_ONLINE',
      pass: true,
      detail: 'Device UI reacted and recovered to ONLINE'
    })
  } catch (err) {
    results.push({ name: 'PHONE-07:SCREEN_RECOVERED_ONLINE', pass: false, detail: String(err) })
  }

  // 5. Assert authenticated communication succeeds after reconnection
  try {
    const res = await fetch(`${params.baseUrl}/api/managed/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.authorizedToken}`
      },
      body: JSON.stringify({
        request_id: 'req-rec-probe-2',
        method: 'managed.listProjects',
        protocol: { name: 'managed', major: 1, minor: 0 },
        caller: { surface: 'mobile' },
        params: {}
      })
    })
    results.push({
      name: 'PHONE-07:RECONNECTED_AUTH_VALID',
      pass: res.status === 200,
      detail: `Status=${res.status}`
    })
  } catch (err) {
    results.push({ name: 'PHONE-07:RECONNECTED_AUTH_VALID', pass: false, detail: String(err) })
  }

  // 6. Assert no duplicate devices were created in database
  try {
    const finalCount = await params.deviceCountCheck()
    const noDuplicates = finalCount === params.initialCount
    results.push({
      name: 'PHONE-07:NO_DUPLICATE_DEVICES',
      pass: noDuplicates,
      detail: `Initial=${params.initialCount}, Final=${finalCount}`
    })
  } catch (err) {
    results.push({ name: 'PHONE-07:NO_DUPLICATE_DEVICES', pass: false, detail: String(err) })
  }

  return results
}
