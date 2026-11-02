import { sha256 } from '@noble/hashes/sha256'
import { decodeBase64Bytes, encodeBase64Bytes } from '../transport/base64-byte-codec'
import type { TrustedHostStore } from './pairing-flow'
import type { MobileDeviceCredential } from './types'

const STORAGE_PREFIX = 'orca.managed.trusted_host.'
const CREDENTIAL_STORAGE_PREFIX = 'orca.managed.credential.'
const fallbackStorage = new Map<string, string>()

async function safeGetItem(key: string): Promise<string | null> {
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
      getItemAsync: (k: string) => Promise<string | null>
    }
    return (await SecureStore?.getItemAsync(key)) ?? null
  } catch {
    return fallbackStorage.get(key) ?? null
  }
}

async function safeSetItem(key: string, value: string): Promise<boolean> {
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
      await AsyncStorage?.setItem(key, value)
      return true
    }
    // oxlint-disable-next-line typescript/no-require-imports
    const SecureStore = require('expo-secure-store') as {
      setItemAsync: (k: string, v: string) => Promise<void>
    }
    await SecureStore?.setItemAsync(key, value)
    return true
  } catch {
    fallbackStorage.set(key, value)
    return true
  }
}

async function safeDeleteItem(key: string): Promise<void> {
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
      deleteItemAsync: (k: string) => Promise<void>
    }
    await SecureStore?.deleteItemAsync(key)
  } catch {
    fallbackStorage.delete(key)
  }
}

function toBase64Url(bytes: Uint8Array): string {
  const b64 = encodeBase64Bytes(bytes)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function computeFingerprintFromPublicKey(publicKeyB64: string): string {
  const bytes = decodeBase64Bytes(publicKeyB64)
  return toBase64Url(sha256(bytes)).slice(0, 16)
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

export class SecureTrustedHostStore implements TrustedHostStore {
  private readonly memoryCache = new Map<string, string>()

  getTrustedHostKey(hostId: string): string | null {
    return this.memoryCache.get(hostId) ?? null
  }

  setTrustedHostKey(hostId: string, publicKey: string): void {
    this.memoryCache.set(hostId, publicKey)
    void this.persistKey(hostId, publicKey)
  }

  async loadPersistentKey(hostId: string): Promise<string | null> {
    const key = `${STORAGE_PREFIX}${hostId}`
    const val = await safeGetItem(key)
    if (val) {
      this.memoryCache.set(hostId, val)
    }
    return val
  }

  async persistKey(hostId: string, publicKey: string): Promise<boolean> {
    this.memoryCache.set(hostId, publicKey)
    const key = `${STORAGE_PREFIX}${hostId}`
    return safeSetItem(key, publicKey)
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
    const existing = (await this.loadPersistentKey(hostId)) ?? this.getTrustedHostKey(hostId)
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

export async function saveStoredCredential(credential: MobileDeviceCredential): Promise<boolean> {
  const key = `${CREDENTIAL_STORAGE_PREFIX}${credential.hostId}`
  return safeSetItem(key, JSON.stringify(credential))
}

export async function removeStoredCredential(hostId: string): Promise<void> {
  const key = `${CREDENTIAL_STORAGE_PREFIX}${hostId}`
  await safeDeleteItem(key)
}
