import { describe, it, expect, beforeEach } from 'vitest'
import {
  createPairingOffer,
  verifyPairingOffer,
  verifyHostProofOfPossession,
  createMobileDeviceCredential,
  validateMobileRequest,
  simulateMobilePairingHandshake,
  resetUsedNoncesForTesting,
  normalizePairingOffer,
  InMemoryTrustedHostStore
} from './pairing-flow'

const PYTHON_GENERATED_VECTOR = {
  offer_id: 'offer-6773edd700329c97',
  host_id: 'host-06-phbw06AOjlRic',
  host_fingerprint: '06-phbw06AOjlRic',
  host_public_key: 'KMsCWIv+fW3YU4ywFIr+r66+dczkegsvhEA2OKbvJnk=',
  host_signature:
    'ML6S1Lb8qilnnx0aNqnoAqDgGJS7HdKub5jCvni5CkBQEjarKWvidMLa2qIwYuM/3SNHtY+hcTRO6eLb+4rqDw==',
  issued_at: 1793596040.1488435,
  expires_at: 1793596340.1488435,
  nonce: 'nonce-765f7915ab6df1bc529d3778f059a046'
}

describe('Mobile Managed Pairing & Integrity Flow', () => {
  beforeEach(() => {
    resetUsedNoncesForTesting()
  })

  it('1. validates fresh pairing offer and rejects expired offer', () => {
    const now = 1730000000000
    const offer = createPairingOffer('host-desktop-1', 'Developer PC', 'SHA256:abcd', now, 300000)
    expect(verifyPairingOffer(offer, now + 1000).ok).toBe(true)
    const expired = verifyPairingOffer(offer, now + 300001)
    expect(expired.ok).toBe(false)
    expect(expired.error).toBe('OFFER_EXPIRED')
  })

  it('2. generates isolated device credentials strictly disjoint from host tokens', () => {
    const knownHostTokens = [
      'f5a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7',
      'e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2'
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
    const firstReq = validateMobileRequest(cred, 'managed.listProjects', nonce)
    expect(firstReq.allowed).toBe(true)
    expect(firstReq.status).toBe('ONLINE')

    const replayedReq = validateMobileRequest(cred, 'managed.listProjects', nonce)
    expect(replayedReq.allowed).toBe(false)
    expect(replayedReq.status).toBe('AUTH_REQUIRED')
    expect(replayedReq.error).toBe('REPLAY_DETECTED')
  })

  it('4. rejects requests from expired or revoked credentials', () => {
    const now = 1730000000000
    const cred = createMobileDeviceCredential('dev-1', 'Phone', 'host-1', '127.0.0.1:8765', now, 1)

    const expRes = validateMobileRequest(
      cred,
      'managed.listProjects',
      'nonce-abc-000000001',
      now + 86400000 + 1000
    )
    expect(expRes.allowed).toBe(false)
    expect(expRes.error).toBe('CREDENTIAL_EXPIRED')

    const revokedCred = { ...cred, revoked: true }
    const revRes = validateMobileRequest(
      revokedCred,
      'managed.listProjects',
      'nonce-abc-000000002',
      now + 100
    )
    expect(revRes.allowed).toBe(false)
    expect(revRes.error).toBe('CREDENTIAL_REVOKED')
  })

  it('5. enforces read-only role boundary: rejects mutations, dispatches and pause/stop', () => {
    const cred = createMobileDeviceCredential('dev-1', 'Phone', 'host-1')
    expect(
      validateMobileRequest(cred, 'managed.getEvidence', 'nonce-allowed-00000001').allowed
    ).toBe(true)
    expect(
      validateMobileRequest(cred, 'managed.requestPause', 'nonce-disabled-00000002').error
    ).toBe('PAUSE_STOP_DISABLED_PENDING_AUDIT')
    expect(
      validateMobileRequest(cred, 'managed.requestStop', 'nonce-disabled-00000003').error
    ).toBe('PAUSE_STOP_DISABLED_PENDING_AUDIT')
    expect(
      validateMobileRequest(cred, 'managed.requestDispatch', 'nonce-forbidden-00001').error
    ).toBe('FORBIDDEN_MUTATION_METHOD')
    expect(
      validateMobileRequest(cred, 'managed.approveVerdict', 'nonce-forbidden-00002').error
    ).toBe('FORBIDDEN_MUTATION_METHOD')
  })

  it('6. cross-language verification: validates authentic Python-generated Ed25519 vector', () => {
    const offer = normalizePairingOffer(PYTHON_GENERATED_VECTOR)
    const verification = verifyHostProofOfPossession(offer)
    expect(verification.ok).toBe(true)
    expect(verification.error).toBeUndefined()
  })

  it('7. cross-language verification: rejects tampered signature and key substitution', () => {
    const offer = normalizePairingOffer(PYTHON_GENERATED_VECTOR)

    // Tampered signature
    const tamperedSig = 'A' + offer.hostSignature!.slice(1)
    const tamperedOffer = { ...offer, hostSignature: tamperedSig }
    const tamperedCheck = verifyHostProofOfPossession(tamperedOffer)
    expect(tamperedCheck.ok).toBe(false)
    expect(tamperedCheck.error).toBe('INVALID_HOST_SIGNATURE')

    // Fingerprint mismatch
    const badFpOffer = { ...offer, fingerprint: 'wrong-fingerprint' }
    const fpCheck = verifyHostProofOfPossession(badFpOffer)
    expect(fpCheck.ok).toBe(false)
    expect(fpCheck.error).toBe('FINGERPRINT_MISMATCH')

    // Key substitution (different valid public key)
    const otherPubKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    const substOffer = { ...offer, hostPublicKey: otherPubKey }
    const substCheck = verifyHostProofOfPossession(substOffer)
    expect(substCheck.ok).toBe(false)
    expect(substCheck.error).toBe('FINGERPRINT_MISMATCH')
  })

  it('8. pins host identity in TrustedHostStore and rejects host key substitution', () => {
    const offer = normalizePairingOffer(PYTHON_GENERATED_VECTOR)
    const store = new InMemoryTrustedHostStore()

    // First handshake pins host key
    const hs1 = simulateMobilePairingHandshake(
      offer,
      'dev-android-1',
      'Pixel 8',
      offer.timestamp + 500,
      [],
      store
    )
    expect(hs1.ok).toBe(true)
    expect(store.getTrustedHostKey(offer.hostId)).toBe(offer.hostPublicKey)

    // Attacker tries to present offer with substituted key for same hostId
    const fakeStore = new InMemoryTrustedHostStore()
    fakeStore.setTrustedHostKey(offer.hostId, 'other-trusted-key-bytes-here==========')
    const hsTampered = simulateMobilePairingHandshake(
      offer,
      'dev-android-1',
      'Pixel 8',
      offer.timestamp + 500,
      [],
      fakeStore
    )
    expect(hsTampered.ok).toBe(false)
    expect(hsTampered.error).toBe('HOST_KEY_MISMATCH')
  })

  it('9. enforces positive allowlist of mobile RPC methods', () => {
    const cred = createMobileDeviceCredential('dev-allow', 'Phone Allow', 'host-1')
    const allowed = [
      'managed.listProjects',
      'managed.listTasks',
      'managed.getExecution',
      'managed.getEvidence',
      'managed.presentReviewPacket',
      'managed.listActivity'
    ]
    for (const m of allowed) {
      const res = validateMobileRequest(cred, m, `nonce-allow-${m}-123456`)
      expect(res.allowed).toBe(true)
      expect(res.status).toBe('ONLINE')
    }
    const unkRes = validateMobileRequest(cred, 'managed.unknownMethod', 'nonce-unk-1234567890')
    expect(unkRes.allowed).toBe(false)
    expect(unkRes.error).toBe('UNKNOWN_METHOD')
  })
})
