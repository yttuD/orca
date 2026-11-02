import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { sha256 } from '@noble/hashes/sha256'
import { decodeBase64Bytes, encodeBase64Bytes } from '../transport/base64-byte-codec'
import type { TrustedHostStore } from './pairing-flow'

const STORAGE_PREFIX = 'orca.managed.trusted_host.'

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
    let val: string | null = null
    try {
      if (Platform.OS === 'web') {
        val = await AsyncStorage.getItem(key)
      } else {
        val = await SecureStore.getItemAsync(key)
      }
    } catch {
      val = null
    }
    if (val) {
      this.memoryCache.set(hostId, val)
    }
    return val
  }

  async persistKey(hostId: string, publicKey: string): Promise<void> {
    this.memoryCache.set(hostId, publicKey)
    const key = `${STORAGE_PREFIX}${hostId}`
    try {
      if (Platform.OS === 'web') {
        await AsyncStorage.setItem(key, publicKey)
      } else {
        await SecureStore.setItemAsync(key, publicKey)
      }
    } catch {
      // Keep in-memory cache if persistent write fails
    }
  }

  async removeTrustedKey(hostId: string): Promise<void> {
    this.memoryCache.delete(hostId)
    const key = `${STORAGE_PREFIX}${hostId}`
    try {
      if (Platform.OS === 'web') {
        await AsyncStorage.removeItem(key)
      } else {
        await SecureStore.deleteItemAsync(key)
      }
    } catch {
      // Ignore cleanup error
    }
  }

  async verifyAndPinHost(
    hostId: string,
    hostPublicKeyB64: string,
    independentFingerprint?: string,
    allowOverride = false
  ): Promise<{ ok: boolean; error?: string }> {
    if (independentFingerprint) {
      const match = verifyIndependentFingerprint(hostPublicKeyB64, independentFingerprint)
      if (!match) {
        return { ok: false, error: 'INDEPENDENT_FINGERPRINT_MISMATCH' }
      }
    }

    const existing = (await this.loadPersistentKey(hostId)) ?? this.getTrustedHostKey(hostId)
    if (existing && existing !== hostPublicKeyB64) {
      if (!allowOverride) {
        return { ok: false, error: 'HOST_KEY_SUBSTITUTION_REJECTED' }
      }
    }

    await this.persistKey(hostId, hostPublicKeyB64)
    return { ok: true }
  }
}
