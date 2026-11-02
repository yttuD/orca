import { describe, it, expect, beforeEach } from 'vitest'
import {
  createPairingOffer,
  verifyPairingOffer,
  createMobileDeviceCredential,
  validateMobileRequest,
  simulateMobilePairingHandshake,
  generateCryptoHex,
  resetUsedNoncesForTesting
} from './pairing-flow'

describe('Mobile Managed Pairing & Integrity Flow', () => {
  beforeEach(() => {
    resetUsedNoncesForTesting()
  })

  it('1. validates fresh pairing offer and rejects expired offer', () => {
    const now = 1730000000000
    const offer = createPairingOffer('host-desktop-1', 'Developer PC', 'SHA256:abcd', now, 300000)

    // Fresh offer is valid
    const valid = verifyPairingOffer(offer, now + 1000)
    expect(valid.ok).toBe(true)

    // Expired offer (> 5 mins) is rejected
    const expired = verifyPairingOffer(offer, now + 300001)
    expect(expired.ok).toBe(false)
    expect(expired.error).toBe('OFFER_EXPIRED')
  })

  it('2. generates isolated device credentials strictly disjoint from host tokens', () => {
    const knownHostTokens = [
      'f5a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7', // operator_token
      'e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2' // bridge_token
    ]

    const cred = createMobileDeviceCredential(
      'pixel-8-pro-id',
      'Pixel 8 Pro',
      'host-1',
      '127.0.0.1:8765',
      Date.now(),
      30,
      knownHostTokens
    )

    expect(cred.deviceToken.length).toBe(64)
    expect(knownHostTokens).not.toContain(cred.deviceToken)
    expect(cred.role).toBe('MOBILE_READONLY')
    expect(cred.revoked).toBe(false)
  })

  it('3. enforces anti-replay protection with nonce tracking', () => {
    const cred = createMobileDeviceCredential('dev-1', 'Phone', 'host-1')
    const nonce = 'unique-nonce-1234567890abcdef'

    // First request with this nonce succeeds
    const firstReq = validateMobileRequest(cred, 'managed.listProjects', nonce)
    expect(firstReq.allowed).toBe(true)
    expect(firstReq.status).toBe('ONLINE')

    // Second request with duplicate nonce is rejected as replay attack
    const replayedReq = validateMobileRequest(cred, 'managed.listProjects', nonce)
    expect(replayedReq.allowed).toBe(false)
    expect(replayedReq.status).toBe('AUTH_REQUIRED')
    expect(replayedReq.error).toBe('REPLAY_DETECTED')
  })

  it('4. rejects requests from expired or revoked credentials', () => {
    const now = 1730000000000
    const cred = createMobileDeviceCredential('dev-1', 'Phone', 'host-1', '127.0.0.1:8765', now, 1)

    // Expired check
    const expiredRes = validateMobileRequest(
      cred,
      'managed.listProjects',
      'nonce-abc-000000001',
      now + 86400000 + 1000
    )
    expect(expiredRes.allowed).toBe(false)
    expect(expiredRes.status).toBe('EXPIRED')
    expect(expiredRes.error).toBe('CREDENTIAL_EXPIRED')

    // Revoked check
    const revokedCred = { ...cred, revoked: true }
    const revokedRes = validateMobileRequest(
      revokedCred,
      'managed.listProjects',
      'nonce-abc-000000002',
      now + 100
    )
    expect(revokedRes.allowed).toBe(false)
    expect(revokedRes.status).toBe('REVOKED')
    expect(revokedRes.error).toBe('CREDENTIAL_REVOKED')
  })

  it('5. enforces read-only role boundary: rejects direct dispatch and approvals', () => {
    const cred = createMobileDeviceCredential('dev-1', 'Phone', 'host-1')

    // Read methods are allowed
    const readRes = validateMobileRequest(cred, 'managed.getEvidence', 'nonce-allowed-00000001')
    expect(readRes.allowed).toBe(true)

    // Request pause/stop are disabled pending independent audit
    const pauseRes = validateMobileRequest(cred, 'managed.requestPause', 'nonce-disabled-00000002')
    expect(pauseRes.allowed).toBe(false)
    expect(pauseRes.error).toBe('PAUSE_STOP_DISABLED_PENDING_AUDIT')

    const stopRes = validateMobileRequest(cred, 'managed.requestStop', 'nonce-disabled-00000003')
    expect(stopRes.allowed).toBe(false)
    expect(stopRes.error).toBe('PAUSE_STOP_DISABLED_PENDING_AUDIT')

    // Mutations such as requestDispatch are strictly forbidden
    const dispatchRes = validateMobileRequest(
      cred,
      'managed.requestDispatch',
      'nonce-forbidden-00001'
    )
    expect(dispatchRes.allowed).toBe(false)
    expect(dispatchRes.error).toBe('FORBIDDEN_MUTATION_METHOD')

    // Direct verdict approvals are strictly forbidden
    const approveRes = validateMobileRequest(
      cred,
      'managed.approveVerdict',
      'nonce-forbidden-00002'
    )
    expect(approveRes.allowed).toBe(false)
    expect(approveRes.error).toBe('FORBIDDEN_MUTATION_METHOD')
  })

  it('6. simulates complete pairing handshake lifecycle without opening network ports', () => {
    const now = 1730000000000
    const offer = createPairingOffer('host-pc-01', 'Ubuntu Host', 'FP-987654321', now)

    const handshake = simulateMobilePairingHandshake(
      offer,
      'android-galaxy-s24',
      'Galaxy S24',
      now + 500
    )

    expect(handshake.ok).toBe(true)
    expect(handshake.credential).toBeDefined()
    expect(handshake.credential?.role).toBe('MOBILE_READONLY')
    expect(handshake.credential?.deviceId).toBe('android-galaxy-s24')

    // Validated request with issued credential
    const req = validateMobileRequest(
      handshake.credential!,
      'managed.presentReviewPacket',
      'nonce-first-call-000001',
      now + 1000
    )
    expect(req.allowed).toBe(true)
    expect(req.status).toBe('ONLINE')
  })

  it('7. uses cryptographically secure generation without Math.random', () => {
    const hex1 = generateCryptoHex(16)
    const hex2 = generateCryptoHex(16)
    expect(hex1).toHaveLength(32)
    expect(hex2).toHaveLength(32)
    expect(hex1).not.toBe(hex2)
    expect(/^[0-9a-f]{32}$/.test(hex1)).toBe(true)
  })
})
