import { describe, it, expect, beforeEach } from 'vitest'
import {
  computeFingerprintFromPublicKey,
  verifyIndependentFingerprint,
  verifyHostFingerprint,
  SecureTrustedHostStore,
  createMemoryStorageDriver,
  setTestSecureStorageDriver,
  loadStoredCredential,
  saveStoredCredential
} from './trusted-host-store'
import type { MobileDeviceCredential } from './types'

const PYTHON_PUBLIC_KEY = 'KMsCWIv+fW3YU4ywFIr+r66+dczkegsvhEA2OKbvJnk='
const PYTHON_FINGERPRINT = '06-phbw06AOjlRic'
const ALIEN_PUBLIC_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

describe('Independent Fingerprint and Secure Trusted Host Store', () => {
  beforeEach(() => {
    setTestSecureStorageDriver(createMemoryStorageDriver())
  })

  it('1. computes canonical 16-char base64url fingerprint identical to Python engine', () => {
    const computed = computeFingerprintFromPublicKey(PYTHON_PUBLIC_KEY)
    expect(computed).toBe(PYTHON_FINGERPRINT)
    expect(computed.length).toBe(16)
  })

  it('2. verifies positive match and rejects mismatched independent fingerprint', () => {
    expect(verifyIndependentFingerprint(PYTHON_PUBLIC_KEY, PYTHON_FINGERPRINT)).toBe(true)
    expect(verifyIndependentFingerprint(PYTHON_PUBLIC_KEY, 'wrong-fingerprint')).toBe(false)
    expect(verifyIndependentFingerprint(PYTHON_PUBLIC_KEY, '')).toBe(false)
    expect(verifyIndependentFingerprint('', PYTHON_FINGERPRINT)).toBe(false)
  })

  it('3. verifyHostFingerprint validates presented vs independent reference and public key', () => {
    const valid = verifyHostFingerprint(PYTHON_FINGERPRINT, PYTHON_FINGERPRINT, PYTHON_PUBLIC_KEY)
    expect(valid.ok).toBe(true)

    const mismatch = verifyHostFingerprint('tampered-fp', PYTHON_FINGERPRINT)
    expect(mismatch.ok).toBe(false)
    expect(mismatch.reason).toBe('FINGERPRINT_MISMATCH')

    const emptyRef = verifyHostFingerprint(PYTHON_FINGERPRINT, '')
    expect(emptyRef.ok).toBe(false)
    expect(emptyRef.reason).toBe('MISSING_INDEPENDENT_REFERENCE')

    const emptyPresented = verifyHostFingerprint('', PYTHON_FINGERPRINT)
    expect(emptyPresented.ok).toBe(false)
    expect(emptyPresented.reason).toBe('MISSING_HOST_FINGERPRINT')

    const keyMismatch = verifyHostFingerprint(
      PYTHON_FINGERPRINT,
      PYTHON_FINGERPRINT,
      ALIEN_PUBLIC_KEY
    )
    expect(keyMismatch.ok).toBe(false)
    expect(keyMismatch.reason).toBe('PUBLIC_KEY_FINGERPRINT_MISMATCH')
  })

  it('4. SecureTrustedHostStore requires independent reference for unpinned hosts', async () => {
    const store = new SecureTrustedHostStore()
    const resWithoutRef = await store.verifyAndPinHost('host-new', PYTHON_PUBLIC_KEY)
    expect(resWithoutRef.ok).toBe(false)
    expect(resWithoutRef.error).toBe('INDEPENDENT_REFERENCE_REQUIRED')

    const resWithBadRef = await store.verifyAndPinHost('host-new', PYTHON_PUBLIC_KEY, 'bad-ref')
    expect(resWithBadRef.ok).toBe(false)
    expect(resWithBadRef.error).toBe('INDEPENDENT_FINGERPRINT_MISMATCH')

    const resWithGoodRef = await store.verifyAndPinHost(
      'host-new',
      PYTHON_PUBLIC_KEY,
      PYTHON_FINGERPRINT
    )
    expect(resWithGoodRef.ok).toBe(true)
    expect(store.getTrustedHostKey('host-new')).toBe(PYTHON_PUBLIC_KEY)
  })

  it('5. SecureTrustedHostStore rejects host key substitution on already pinned hosts', async () => {
    const store = new SecureTrustedHostStore()
    await store.verifyAndPinHost('host-pinned', PYTHON_PUBLIC_KEY, PYTHON_FINGERPRINT)
    expect(store.getTrustedHostKey('host-pinned')).toBe(PYTHON_PUBLIC_KEY)

    const substitute = await store.verifyAndPinHost('host-pinned', ALIEN_PUBLIC_KEY)
    expect(substitute.ok).toBe(false)
    expect(substitute.error).toBe('HOST_KEY_SUBSTITUTION_REJECTED')
    expect(store.getTrustedHostKey('host-pinned')).toBe(PYTHON_PUBLIC_KEY)
  })

  it('6. persists credential and recovers from secure storage', async () => {
    const cred: MobileDeviceCredential = {
      deviceId: 'motog20-1',
      deviceName: 'Motorola Moto G20',
      deviceToken: 'token-xyz',
      hostId: 'host-pinned',
      hostFingerprint: PYTHON_FINGERPRINT,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      role: 'MOBILE_READONLY',
      revoked: false,
      nonce: 'nonce-1',
      status: 'ONLINE'
    }
    const saved = await saveStoredCredential(cred, 'host-pinned')
    expect(saved).toBe(true)

    const loaded = await loadStoredCredential('host-pinned')
    expect(loaded).toEqual(cred)
  })
})
