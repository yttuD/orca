import React, { useMemo, useEffect, useState } from 'react'
import { SafeAreaView, StyleSheet } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ManagedCenterView } from '../src/managed/ManagedCenterView'
import { EncryptedRpcManagedDataProvider } from '../src/managed/data-provider'
import { useHostClient } from '../src/transport/host-client-hooks'
import { loadHosts } from '../src/transport/host-store'
import {
  loadStoredCredential,
  saveStoredCredential,
  verifyHostFingerprint,
  normalizeHostPublicKey,
  computeFingerprintFromPublicKey,
  SecureTrustedHostStore
} from '../src/managed/trusted-host-store'
import type { MobileConnectionStatus, MobileDeviceCredential } from '../src/managed/types'
import type { HostProfile } from '../src/transport/types'

export default function NativeManagedRoute(): React.JSX.Element {
  const router = useRouter()
  const { hostId, expectedFingerprint, pin } = useLocalSearchParams<{
    hostId?: string
    expectedFingerprint?: string
    pin?: string
  }>()
  const [activeHost, setActiveHost] = useState<HostProfile | null>(null)
  const [credential, setCredential] = useState<MobileDeviceCredential | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<MobileConnectionStatus>('UNPAIRED')
  const [, setStatusDetail] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function initHostAndCredential(): Promise<void> {
      try {
        const hosts = await loadHosts()
        if (!mounted) {
          return
        }
        if (hosts.length > 0) {
          const sorted = [...hosts].sort((a, b) => (b.lastConnected ?? 0) - (a.lastConnected ?? 0))
          const host = (hostId ? hosts.find((h) => h.id === hostId) : undefined) ?? sorted[0]
          setActiveHost(host)

          const cred = await loadStoredCredential(host.id)
          if (mounted && cred) {
            if (cred.revoked || Date.now() > cred.expiresAt) {
              setConnectionStatus('AUTH_REQUIRED')
            } else if (cred.status === 'PENDING_APPROVAL') {
              setConnectionStatus('PENDING_APPROVAL')
            } else {
              setConnectionStatus('CONNECTING')
            }
            setCredential(cred)
          } else if (mounted) {
            setConnectionStatus('UNPAIRED')
          }
        } else {
          setConnectionStatus('UNPAIRED')
        }
      } catch {
        if (mounted) {
          setConnectionStatus('UNPAIRED')
        }
      }
    }

    void initHostAndCredential()
    return () => {
      mounted = false
    }
  }, [hostId])

  const { client, state } = useHostClient(activeHost?.id)

  const provider = useMemo(() => {
    if (!client) {
      return undefined
    }
    return new EncryptedRpcManagedDataProvider(client, credential)
  }, [client, credential])

  useEffect(() => {
    if (!activeHost || !credential) {
      setConnectionStatus('UNPAIRED')
      return
    }
    if (credential.revoked || Date.now() > credential.expiresAt) {
      setConnectionStatus('AUTH_REQUIRED')
      return
    }
    if (!provider || !client) {
      setConnectionStatus('CONNECTING')
      return
    }
    if (state !== 'connected') {
      setConnectionStatus(state === 'connecting' ? 'CONNECTING' : 'OFFLINE')
      return
    }

    let active = true
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const checkAuth = async () => {
      try {
        setConnectionStatus('CONNECTING')
        const st = await provider.probeAuthentication()
        if (!active) {
          return
        }
        setConnectionStatus(st)
        if (st === 'PENDING_APPROVAL') {
          pollTimer = setInterval(async () => {
            if (!active) {
              if (pollTimer) {
                clearInterval(pollTimer)
              }
              return
            }
            const nextSt = await provider.probeAuthentication()
            if (active) {
              setConnectionStatus(nextSt)
              if (nextSt !== 'PENDING_APPROVAL') {
                if (pollTimer) {
                  clearInterval(pollTimer)
                  pollTimer = null
                }
                if (nextSt === 'ONLINE' && credential) {
                  const updated = { ...credential, status: 'ONLINE' }
                  setCredential(updated)
                  await saveStoredCredential(updated, activeHost.id)
                }
              }
            }
          }, 2000)
        }
      } catch {
        if (active) {
          setConnectionStatus('AUTH_REQUIRED')
        }
      }
    }

    void checkAuth()
    return () => {
      active = false
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }
  }, [provider, client, state, credential, activeHost])

  const handlePairOrRegister = async () => {
    if (activeHost && client && state === 'connected') {
      try {
        setConnectionStatus('CONNECTING')
        setStatusDetail(null)
        const hostIdentityRes = await client.sendRequest('managed.getHostIdentity', {})
        if (!hostIdentityRes.ok) {
          throw new Error(hostIdentityRes.error.message || 'HOST_IDENTITY_FAILED')
        }
        const hostIdentity = hostIdentityRes.result
        const hostFp = ((hostIdentity as Record<string, unknown>)?.fingerprint ||
          (hostIdentity as Record<string, unknown>)?.host_fingerprint ||
          '') as string
        const hostPubKey = normalizeHostPublicKey(hostIdentity)
        if (!hostPubKey) {
          throw new Error('HOST_PUBLIC_KEY_REQUIRED')
        }
        const computedFp = computeFingerprintFromPublicKey(hostPubKey)
        if (hostFp && hostFp !== computedFp) {
          throw new Error('HOST_FINGERPRINT_CORRUPTED')
        }

        const trustedStore = new SecureTrustedHostStore()
        const pinnedKey = await trustedStore.loadPersistentKey(activeHost.id)

        let verifiedPubKey: string
        if (pinnedKey) {
          if (pinnedKey !== hostPubKey) {
            const errStr = 'HOST_KEY_SUBSTITUTION_REJECTED: Pinned key mismatch'
            setStatusDetail(errStr)
            setConnectionStatus('AUTH_REQUIRED')
            throw new Error(errStr)
          }
          verifiedPubKey = pinnedKey
        } else {
          // Require independent out-of-band reference from operator or paired profile
          const independentRef =
            expectedFingerprint ||
            pin ||
            (activeHost.publicKeyB64
              ? computeFingerprintFromPublicKey(activeHost.publicKeyB64)
              : undefined)
          if (!independentRef) {
            const errStr = 'INDEPENDENT_REFERENCE_REQUIRED: Se requiere referencia independiente'
            setStatusDetail(errStr)
            setConnectionStatus('AUTH_REQUIRED')
            throw new Error(errStr)
          }
          const check = verifyHostFingerprint(computedFp, independentRef, hostPubKey)
          if (!check.ok) {
            const errStr = `FINGERPRINT_MISMATCH: ${check.reason}`
            setStatusDetail(errStr)
            setConnectionStatus('AUTH_REQUIRED')
            throw new Error(errStr)
          }
          verifiedPubKey = hostPubKey
        }

        const devId = `motog20-${Date.now().toString(36)}`
        const regRes = await client.sendRequest('managed.registerDevice', {
          deviceId: devId,
          deviceName: 'Motorola Moto G20',
          clientNonce: `cnonce-${Date.now()}`,
          confirmedFingerprint: computedFp
        })
        if (!regRes.ok) {
          throw new Error(regRes.error.message || 'REGISTRATION_FAILED')
        }
        const regData = regRes.result as { ok: boolean; credential: MobileDeviceCredential }
        if (regData.ok && regData.credential) {
          await trustedStore.persistKey(activeHost.id, verifiedPubKey)
          await saveStoredCredential(regData.credential, activeHost.id)
          setCredential(regData.credential)
          setConnectionStatus('PENDING_APPROVAL')
        } else {
          setConnectionStatus('AUTH_REQUIRED')
        }
      } catch (err) {
        console.warn('Managed registration error:', err)
        setConnectionStatus('AUTH_REQUIRED')
      }
    } else {
      router.push('/pair')
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ManagedCenterView
        connectionStatus={connectionStatus}
        deviceName={credential?.deviceName || 'Motorola Moto G20'}
        deviceId={credential?.deviceId || 'moto-g20'}
        dataProvider={provider}
        onBack={() => router.back()}
        onPairPress={() => void handlePairOrRegister()}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b'
  }
})
