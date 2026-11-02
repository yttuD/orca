import nacl from 'tweetnacl'
import { sha256 } from '@noble/hashes/sha256'
import { decodeBase64Bytes, encodeBase64Bytes } from '../transport/base64-byte-codec'
import {
  type MobileDeviceCredential,
  type PairingOffer,
  type PairingHandshake,
  type MobileConnectionStatus,
  FORBIDDEN_MOBILE_METHODS,
  AUDIT_DISABLED_MOBILE_METHODS,
  ALLOWED_MOBILE_METHODS
} from './types'

export { FORBIDDEN_MOBILE_METHODS, AUDIT_DISABLED_MOBILE_METHODS, ALLOWED_MOBILE_METHODS }

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

export interface TrustedHostStore {
  getTrustedHostKey(hostId: string): string | null
  setTrustedHostKey(hostId: string, publicKey: string): void
}

export class InMemoryTrustedHostStore implements TrustedHostStore {
  private readonly store = new Map<string, string>()
  getTrustedHostKey(hostId: string): string | null {
    return this.store.get(hostId) ?? null
  }
  setTrustedHostKey(hostId: string, publicKey: string): void {
    this.store.set(hostId, publicKey)
  }
}

function toBase64Url(bytes: Uint8Array): string {
  const b64 = encodeBase64Bytes(bytes)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function createPairingOffer(
  hostId: string,
  hostName: string,
  fingerprint: string,
  now = Date.now(),
  ttlMs = 300000
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

export function normalizePairingOffer(raw: Record<string, unknown>): PairingOffer {
  const offerId = String(raw.offerId || raw.offer_id || '')
  const hostId = String(raw.hostId || raw.host_id || '')
  const hostName = String(raw.hostName || raw.host_name || hostId || 'Orca Desktop')
  const fingerprint = String(raw.fingerprint || raw.host_fingerprint || '')
  const rawTs = Number(raw.timestamp ?? raw.issued_at ?? Date.now())
  const timestamp = rawTs < 10000000000 ? Math.floor(rawTs * 1000) : Math.floor(rawTs)
  const rawExp = Number(raw.expiresAt ?? raw.expires_at ?? timestamp + 300000)
  const expiresAt = rawExp < 10000000000 ? Math.floor(rawExp * 1000) : Math.floor(rawExp)
  const nonce = String(raw.nonce || '')
  const hostPublicKey = raw.hostPublicKey
    ? String(raw.hostPublicKey)
    : raw.host_public_key
      ? String(raw.host_public_key)
      : undefined
  const hostSignature = raw.hostSignature
    ? String(raw.hostSignature)
    : raw.host_signature
      ? String(raw.host_signature)
      : undefined

  return {
    offerId,
    hostId,
    hostName,
    fingerprint,
    timestamp,
    expiresAt,
    nonce,
    hostPublicKey,
    hostSignature
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

export function verifyHostProofOfPossession(
  offer: PairingOffer,
  trustedHostStore?: TrustedHostStore
): { ok: boolean; error?: string } {
  if (!offer.hostSignature) {
    return { ok: false, error: 'MISSING_HOST_SIGNATURE' }
  }
  if (!offer.hostPublicKey) {
    return { ok: false, error: 'MISSING_HOST_PUBLIC_KEY' }
  }

  let pubBytes: Uint8Array
  let sigBytes: Uint8Array
  try {
    pubBytes = decodeBase64Bytes(offer.hostPublicKey)
    sigBytes = decodeBase64Bytes(offer.hostSignature)
  } catch {
    return { ok: false, error: 'MALFORMED_CRYPTO_ENCODING' }
  }

  if (pubBytes.length !== 32) {
    return { ok: false, error: 'INVALID_PUBLIC_KEY_LENGTH' }
  }
  if (sigBytes.length !== 64) {
    return { ok: false, error: 'INVALID_SIGNATURE_LENGTH' }
  }

  const computedFingerprint = toBase64Url(sha256(pubBytes)).slice(0, 16)
  if (computedFingerprint !== offer.fingerprint) {
    return { ok: false, error: 'FINGERPRINT_MISMATCH' }
  }

  if (trustedHostStore) {
    const trustedKey = trustedHostStore.getTrustedHostKey(offer.hostId)
    if (trustedKey && trustedKey !== offer.hostPublicKey) {
      return { ok: false, error: 'HOST_KEY_MISMATCH' }
    }
  }

  const tsSec = Math.floor(offer.timestamp / 1000)
  const message = `${offer.offerId}:${offer.nonce}:${tsSec}:${offer.fingerprint}`
  const msgBytes = new TextEncoder().encode(message)

  const isValid = nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes)
  if (!isValid) {
    return { ok: false, error: 'INVALID_HOST_SIGNATURE' }
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
    return { allowed: false, status: 'UNVERIFIED', error: 'CREDENTIAL_REVOKED' }
  }
  if (now > credential.expiresAt) {
    return { allowed: false, status: 'AUTH_REQUIRED', error: 'CREDENTIAL_EXPIRED' }
  }
  if (!requestNonce || requestNonce.length < 16) {
    return { allowed: false, status: 'AUTH_REQUIRED', error: 'NONCE_TOO_SHORT' }
  }
  if (USED_NONCES.has(requestNonce)) {
    return { allowed: false, status: 'AUTH_REQUIRED', error: 'REPLAY_DETECTED' }
  }
  USED_NONCES.add(requestNonce)

  if ((FORBIDDEN_MOBILE_METHODS as readonly string[]).includes(method)) {
    return { allowed: false, status: 'AUTH_REQUIRED', error: 'FORBIDDEN_MUTATION_METHOD' }
  }
  if ((AUDIT_DISABLED_MOBILE_METHODS as readonly string[]).includes(method)) {
    return { allowed: false, status: 'AUTH_REQUIRED', error: 'PAUSE_STOP_DISABLED_PENDING_AUDIT' }
  }
  if (!(ALLOWED_MOBILE_METHODS as readonly string[]).includes(method)) {
    return { allowed: false, status: 'AUTH_REQUIRED', error: 'UNKNOWN_METHOD' }
  }

  return { allowed: true, status: 'ONLINE' }
}

export function simulateMobilePairingHandshake(
  offer: PairingOffer,
  deviceId: string,
  deviceName: string,
  now = Date.now(),
  prohibitedTokens: readonly string[] = [],
  trustedHostStore?: TrustedHostStore
): { ok: boolean; credential?: MobileDeviceCredential; error?: string } {
  const offerCheck = verifyPairingOffer(offer, now)
  if (!offerCheck.ok) {
    return { ok: false, error: offerCheck.error }
  }

  const proofCheck = verifyHostProofOfPossession(offer, trustedHostStore)
  if (!proofCheck.ok) {
    return { ok: false, error: proofCheck.error }
  }

  if (
    trustedHostStore &&
    offer.hostPublicKey &&
    !trustedHostStore.getTrustedHostKey(offer.hostId)
  ) {
    trustedHostStore.setTrustedHostKey(offer.hostId, offer.hostPublicKey)
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
