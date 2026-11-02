import type {
  MobileDeviceCredential,
  PairingOffer,
  PairingHandshake,
  MobileConnectionStatus
} from './types'

export const FORBIDDEN_MOBILE_METHODS = [
  'managed.requestDispatch',
  'managed.approveVerdict',
  'managed.rejectVerdict',
  'operator.createProject',
  'operator.deleteProject',
  'operator.publishBridgeEvent',
  'admin.shutdown'
] as const

export const AUDIT_DISABLED_MOBILE_METHODS = [
  'managed.requestPause',
  'managed.requestStop'
] as const

export const ALLOWED_MOBILE_METHODS = [
  'managed.listProjects',
  'managed.listTasks',
  'managed.getExecution',
  'managed.getEvidence',
  'managed.presentReviewPacket',
  'managed.listActivity'
] as const

const USED_NONCES = new Set<string>()

export function resetUsedNoncesForTesting(): void {
  USED_NONCES.clear()
}

export function generateCryptoHex(byteLength = 32): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(byteLength)
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto')
    return nodeCrypto.randomBytes(byteLength).toString('hex')
  } catch {
    throw new Error('No cryptographically secure PRNG available')
  }
}

export function createPairingOffer(
  hostId: string,
  hostName: string,
  fingerprint: string,
  now = Date.now(),
  ttlMs = 300000 // 5 minutes validity
): PairingOffer {
  return {
    offerId: `offer-${generateCryptoHex(8)}`,
    hostId,
    hostName,
    fingerprint,
    timestamp: now,
    expiresAt: now + ttlMs,
    nonce: `nonce-${generateCryptoHex(16)}`
  }
}

export function verifyPairingOffer(
  offer: PairingOffer,
  now = Date.now()
): { ok: boolean; error?: string } {
  if (now > offer.expiresAt) {
    return { ok: false, error: 'OFFER_EXPIRED' }
  }
  if (offer.timestamp > now + 60000 || offer.timestamp < now - 360000) {
    return { ok: false, error: 'TIMESTAMP_DRIFT' }
  }
  if (!offer.nonce || offer.nonce.length < 16) {
    return { ok: false, error: 'INVALID_NONCE' }
  }
  return { ok: true }
}

export function createMobileDeviceCredential(
  deviceId: string,
  deviceName: string,
  hostId: string,
  hostAddress = '127.0.0.1:8765',
  now = Date.now(),
  ttlDays = 30,
  prohibitedTokens: readonly string[] = []
): MobileDeviceCredential {
  let token = generateCryptoHex(32)
  while (prohibitedTokens.includes(token)) {
    token = generateCryptoHex(32)
  }

  const ttlMs = ttlDays * 24 * 60 * 60 * 1000
  return {
    deviceId,
    deviceName,
    deviceToken: token,
    hostId,
    hostAddress,
    issuedAt: now,
    expiresAt: now + ttlMs,
    role: 'MOBILE_READONLY',
    revoked: false,
    nonce: `cred-${generateCryptoHex(12)}`
  }
}

export function validateMobileRequest(
  credential: MobileDeviceCredential | null,
  method: string,
  requestNonce: string,
  now = Date.now()
): { allowed: boolean; status: MobileConnectionStatus; error?: string } {
  if (!credential) {
    return { allowed: false, status: 'UNPAIRED', error: 'DEVICE_NOT_PAIRED' }
  }

  if (credential.revoked) {
    return { allowed: false, status: 'REVOKED', error: 'CREDENTIAL_REVOKED' }
  }

  if (now > credential.expiresAt) {
    return { allowed: false, status: 'EXPIRED', error: 'CREDENTIAL_EXPIRED' }
  }

  // Anti-replay protection
  if (!requestNonce || requestNonce.length < 16) {
    return { allowed: false, status: 'AUTH_REQUIRED', error: 'NONCE_TOO_SHORT' }
  }

  if (USED_NONCES.has(requestNonce)) {
    return { allowed: false, status: 'AUTH_REQUIRED', error: 'REPLAY_DETECTED' }
  }
  USED_NONCES.add(requestNonce)

  // Role limitation: Disallow direct mutations, dispatches, and approvals
  if ((FORBIDDEN_MOBILE_METHODS as readonly string[]).includes(method)) {
    return { allowed: false, status: 'AUTH_REQUIRED', error: 'FORBIDDEN_MUTATION_METHOD' }
  }

  // Pause and stop remain disabled pending independent audit
  if ((AUDIT_DISABLED_MOBILE_METHODS as readonly string[]).includes(method)) {
    return { allowed: false, status: 'AUTH_REQUIRED', error: 'PAUSE_STOP_DISABLED_PENDING_AUDIT' }
  }

  if (!(ALLOWED_MOBILE_METHODS as readonly string[]).includes(method)) {
    return { allowed: false, status: 'AUTH_REQUIRED', error: 'UNKNOWN_METHOD' }
  }

  return { allowed: true, status: 'ONLINE' }
}

export function verifyHostProofOfPossession(
  offer: PairingOffer,
  verifyFn?: (message: string, signature: string, publicKey: string) => boolean
): { ok: boolean; error?: string } {
  if (!offer.hostSignature) {
    return { ok: false, error: 'MISSING_HOST_SIGNATURE' }
  }
  if (!offer.hostPublicKey) {
    return { ok: false, error: 'MISSING_HOST_PUBLIC_KEY' }
  }
  const tsSec = Math.floor(offer.timestamp / 1000)
  const message = `${offer.offerId}:${offer.nonce}:${tsSec}:${offer.fingerprint}`
  if (verifyFn) {
    const valid = verifyFn(message, offer.hostSignature, offer.hostPublicKey)
    if (!valid) {
      return { ok: false, error: 'INVALID_HOST_SIGNATURE' }
    }
  }
  return { ok: true }
}

export function simulateMobilePairingHandshake(
  offer: PairingOffer,
  deviceId: string,
  deviceName: string,
  now = Date.now(),
  prohibitedTokens: readonly string[] = [],
  verifyFn?: (message: string, signature: string, publicKey: string) => boolean
): { ok: boolean; credential?: MobileDeviceCredential; error?: string } {
  const offerCheck = verifyPairingOffer(offer, now)
  if (!offerCheck.ok) {
    return { ok: false, error: offerCheck.error }
  }

  if (offer.hostSignature || offer.hostPublicKey) {
    const proofCheck = verifyHostProofOfPossession(offer, verifyFn)
    if (!proofCheck.ok) {
      return { ok: false, error: proofCheck.error }
    }
  }

  const handshake: PairingHandshake = {
    deviceId,
    deviceName,
    offerId: offer.offerId,
    clientNonce: `cnonce-${generateCryptoHex(12)}`,
    timestamp: now
  }

  if (!handshake.deviceId || !handshake.deviceName) {
    return { ok: false, error: 'INVALID_HANDSHAKE' }
  }

  const cred = createMobileDeviceCredential(
    deviceId,
    deviceName,
    offer.hostId,
    '127.0.0.1:8765',
    now,
    30,
    prohibitedTokens
  )

  return { ok: true, credential: cred }
}
