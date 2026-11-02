import { sha256 } from '@noble/hashes/sha256'
import { decodeBase64Bytes, encodeBase64Bytes } from '../transport/base64-byte-codec'
import type { TrustedHostStore } from './pairing-flow'
import type { MobileDeviceCredential } from './types'

const STORAGE_PREFIX = 'orca.managed.trusted_host.'
const CREDENTIAL_STORAGE_PREFIX = 'orca.managed.credential.'

export type SecureStorageDriver = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  deleteItem: (key: string) => Promise<void>
}

let testStorageDriver: SecureStorageDriver | null = null

export function setTestSecureStorageDriver(driver: SecureStorageDriver | null): void {
  testStorageDriver = driver
}

export function createMemoryStorageDriver(): SecureStorageDriver {
  const store = new Map<string, string>()
  return {
    async getItem(key: string) {
      return store.get(key) ?? null
    },
    async setItem(key: string, value: string) {
      store.set(key, value)
    },
    async deleteItem(key: string) {
      store.delete(key)
    }
  }
}

async function safeGetItem(key: string): Promise<string | null> {
  if (testStorageDriver) {
    try {
      return await testStorageDriver.getItem(key)
    } catch {
      return null
    }
  }
  try {
    // oxlint-disable-next-line typescript/no-require-imports
    const { Platform } = require('react-native') as { Platform?: { OS: string } }
    if (Platform?.OS === 'web') {
      // oxlint-disable-next-line typescript/no-require-imports
      const AsyncStorage = (
        require('@react-native-async-storage/async-storage') as {
          default?: { getItem: (k: string) => Promise<string | null> }
        }
      ).default
      return (await AsyncStorage?.getItem(key)) ?? null
    }
    // oxlint-disable-next-line typescript/no-require-imports
    const SecureStore = require('expo-secure-store') as {
      getItemAsync?: (k: string) => Promise<string | null>
    }
    return (await SecureStore?.getItemAsync?.(key)) ?? null
  } catch {
    return null
  }
}

async function safeSetItem(key: string, value: string): Promise<boolean> {
  if (testStorageDriver) {
    try {
      await testStorageDriver.setItem(key, value)
      return true
    } catch {
      return false
    }
  }
  try {
    // oxlint-disable-next-line typescript/no-require-imports
    const { Platform } = require('react-native') as { Platform?: { OS: string } }
    if (Platform?.OS === 'web') {
      // oxlint-disable-next-line typescript/no-require-imports
      const AsyncStorage = (
        require('@react-native-async-storage/async-storage') as {
          default?: { setItem: (k: string, v: string) => Promise<void> }
        }
      ).default
      if (!AsyncStorage?.setItem) {
        return false
      }
      await AsyncStorage.setItem(key, value)
      return true
    }
    // oxlint-disable-next-line typescript/no-require-imports
    const SecureStore = require('expo-secure-store') as {
      setItemAsync?: (k: string, v: string) => Promise<void>
    }
    if (!SecureStore?.setItemAsync) {
      return false
    }
    await SecureStore.setItemAsync(key, value)
    return true
  } catch {
    return false
  }
}

async function safeDeleteItem(key: string): Promise<void> {
  if (testStorageDriver) {
    try {
      await testStorageDriver.deleteItem(key)
    } catch {}
    return
  }
  try {
    // oxlint-disable-next-line typescript/no-require-imports
    const { Platform } = require('react-native') as { Platform?: { OS: string } }
    if (Platform?.OS === 'web') {
      // oxlint-disable-next-line typescript/no-require-imports
      const AsyncStorage = (
        require('@react-native-async-storage/async-storage') as {
          default?: { removeItem: (k: string) => Promise<void> }
        }
      ).default
      await AsyncStorage?.removeItem(key)
      return
    }
    // oxlint-disable-next-line typescript/no-require-imports
    const SecureStore = require('expo-secure-store') as {
      deleteItemAsync?: (k: string) => Promise<void>
    }
    await SecureStore?.deleteItemAsync?.(key)
  } catch {}
}

function toBase64Url(bytes: Uint8Array): string {
  const b64 = encodeBase64Bytes(bytes)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function computeFingerprintFromPublicKey(publicKeyB64: string): string {
  const bytes = decodeBase64Bytes(publicKeyB64)
  return toBase64Url(sha256(bytes)).slice(0, 16)
}

export function normalizeHostPublicKey(identity: unknown): string {
  if (!identity || typeof identity !== 'object') {
    return ''
  }
  const obj = identity as Record<string, unknown>
  const cand = (obj.host_public_key || obj.public_key || obj.publicKeyB64 || '') as string
  if (typeof cand !== 'string') {
    return ''
  }
  const clean = cand.trim()
  return clean.length >= 32 ? clean : ''
}

export function verifyIndependentFingerprint(
  publicKeyB64: string,
  independentReference: string
): boolean {
  if (!publicKeyB64 || !independentReference) {
    return false
  }
  const cleanRef = independentReference.trim()
  const computed = computeFingerprintFromPublicKey(publicKeyB64)
  return computed === cleanRef
}

export function verifyHostFingerprint(
  presentedFingerprint: string,
  independentReference: string,
  publicKeyB64?: string
): { ok: boolean; reason?: string } {
  if (!presentedFingerprint || !presentedFingerprint.trim()) {
    return { ok: false, reason: 'MISSING_HOST_FINGERPRINT' }
  }
  if (!independentReference || !independentReference.trim()) {
    return { ok: false, reason: 'MISSING_INDEPENDENT_REFERENCE' }
  }
  const cleanPresented = presentedFingerprint.trim()
  const cleanRef = independentReference.trim()
  if (cleanPresented !== cleanRef) {
    return { ok: false, reason: 'FINGERPRINT_MISMATCH' }
  }
  if (publicKeyB64) {
    const computed = computeFingerprintFromPublicKey(publicKeyB64)
    if (computed !== cleanRef) {
      return { ok: false, reason: 'PUBLIC_KEY_FINGERPRINT_MISMATCH' }
    }
  }
  return { ok: true }
}

export class SecureTrustedHostStore implements TrustedHostStore {
  private readonly memoryCache = new Map<string, string>()

  getTrustedHostKey(hostId: string): string | null {
    return this.memoryCache.get(hostId) ?? null
  }

  setTrustedHostKey(hostId: string, publicKey: string): void {
    if (publicKey && publicKey.length >= 32) {
      this.memoryCache.set(hostId, publicKey)
      void this.persistKey(hostId, publicKey)
    }
  }

  async loadPersistentKey(hostId: string): Promise<string | null> {
    const key = `${STORAGE_PREFIX}${hostId}`
    const val = await safeGetItem(key)
    if (val) {
      this.memoryCache.set(hostId, val)
    } else {
      this.memoryCache.delete(hostId)
    }
    return val
  }

  async persistKey(hostId: string, publicKey: string): Promise<boolean> {
    if (!publicKey || publicKey.length < 32) {
      throw new Error('CANNOT_STORE_FINGERPRINT_AS_PUBLIC_KEY')
    }
    const key = `${STORAGE_PREFIX}${hostId}`
    const success = await safeSetItem(key, publicKey)
    if (success) {
      this.memoryCache.set(hostId, publicKey)
    } else {
      this.memoryCache.delete(hostId)
    }
    return success
  }

  async removeTrustedKey(hostId: string): Promise<void> {
    this.memoryCache.delete(hostId)
    const key = `${STORAGE_PREFIX}${hostId}`
    await safeDeleteItem(key)
  }

  async verifyAndPinHost(
    hostId: string,
    hostPublicKeyB64: string,
    independentFingerprint?: string,
    allowOverride = false
  ): Promise<{ ok: boolean; error?: string }> {
    if (!hostPublicKeyB64 || hostPublicKeyB64.length < 32) {
      return { ok: false, error: 'INVALID_PUBLIC_KEY' }
    }
    const existing = await this.loadPersistentKey(hostId)
    if (existing && existing !== hostPublicKeyB64) {
      if (!allowOverride) {
        return { ok: false, error: 'HOST_KEY_SUBSTITUTION_REJECTED' }
      }
    }

    if (independentFingerprint) {
      const match = verifyIndependentFingerprint(hostPublicKeyB64, independentFingerprint)
      if (!match) {
        return { ok: false, error: 'INDEPENDENT_FINGERPRINT_MISMATCH' }
      }
    } else if (!existing && !allowOverride) {
      return { ok: false, error: 'INDEPENDENT_REFERENCE_REQUIRED' }
    }

    const persisted = await this.persistKey(hostId, hostPublicKeyB64)
    if (!persisted) {
      this.memoryCache.delete(hostId)
      return { ok: false, error: 'STORAGE_PERSISTENCE_FAILED' }
    }
    return { ok: true }
  }
}

export async function loadStoredCredential(hostId: string): Promise<MobileDeviceCredential | null> {
  const key = `${CREDENTIAL_STORAGE_PREFIX}${hostId}`
  const raw = await safeGetItem(key)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as MobileDeviceCredential
  } catch {
    return null
  }
}

export async function saveStoredCredential(
  credential: MobileDeviceCredential,
  hostKey?: string
): Promise<boolean> {
  const targetKey = hostKey || credential.hostId
  const primaryKey = `${CREDENTIAL_STORAGE_PREFIX}${targetKey}`
  const ok = await safeSetItem(primaryKey, JSON.stringify(credential))
  if (credential.nativeHostId && credential.nativeHostId !== targetKey) {
    await safeSetItem(
      `${CREDENTIAL_STORAGE_PREFIX}${credential.nativeHostId}`,
      JSON.stringify(credential)
    )
  }
  if (credential.hostId && credential.hostId !== targetKey) {
    await safeSetItem(
      `${CREDENTIAL_STORAGE_PREFIX}${credential.hostId}`,
      JSON.stringify(credential)
    )
  }
  return ok
}

export async function removeStoredCredential(hostId: string): Promise<void> {
  await safeDeleteItem(`${CREDENTIAL_STORAGE_PREFIX}${hostId}`)
}
