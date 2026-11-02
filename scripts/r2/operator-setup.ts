/**
 * Helper for operator session unlock, device queries, and legitimate lab credential generation.
 */
export type OperatorSession = {
  sessionCookie: string
  csrfToken: string
}

export async function unlockOperatorSession(port: number, token: string): Promise<OperatorSession> {
  const unlockResp = await fetch(`http://127.0.0.1:${port}/api/auth/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  })
  const sessionCookie =
    /orchestrator_session=([^;]+)/.exec(unlockResp.headers.get('set-cookie') ?? '')?.[0] ?? ''
  const csrfToken = ((await unlockResp.json()) as { csrf_token: string }).csrf_token
  return { sessionCookie, csrfToken }
}

export async function getAuthorizedDevice(
  port: number,
  session: OperatorSession
): Promise<{ device_id: string; status: string }> {
  const devListRes = await fetch(`http://127.0.0.1:${port}/api/managed/mobile/devices`, {
    headers: { Cookie: session.sessionCookie }
  })
  const devList = (await devListRes.json()) as {
    devices: { device_id: string; status: string }[]
  }
  const authorizedDev = devList.devices.find((d) => d.status === 'AUTHORIZED')
  if (!authorizedDev) {
    throw new Error('Authorized device not found')
  }
  return authorizedDev
}

export async function createAuthorizedLabToken(
  port: number,
  session: OperatorSession,
  deviceId = 'motog20-lab-device-sec'
): Promise<string> {
  const offerRes = await fetch(`http://127.0.0.1:${port}/api/managed/mobile/offer`, {
    method: 'POST',
    headers: { 'X-CSRF-Token': session.csrfToken, Cookie: session.sessionCookie }
  })
  const offerData = (await offerRes.json()) as { offer: { offer_id: string } }
  const regRes = await fetch(`http://127.0.0.1:${port}/api/managed/mobile/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      offer_id: offerData.offer.offer_id,
      device_id: deviceId,
      device_name: 'Motorola Moto G20 (Lab Auth)',
      client_nonce: `cnonce-${Date.now()}-sec-1234`
    })
  })
  const regJson = (await regRes.json()) as { device: { token: string } }
  const token = regJson.device.token
  await fetch(`http://127.0.0.1:${port}/api/managed/mobile/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrfToken,
      Cookie: session.sessionCookie
    },
    body: JSON.stringify({ device_id: deviceId })
  })
  return token
}
