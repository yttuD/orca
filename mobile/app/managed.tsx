import React, { useMemo, useEffect, useState } from 'react'
import { SafeAreaView, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { ManagedCenterView } from '../src/managed/ManagedCenterView'
import { EncryptedRpcManagedDataProvider } from '../src/managed/data-provider'
import { useHostClient } from '../src/transport/host-client-hooks'
import { loadHosts } from '../src/transport/host-store'
import { loadStoredCredential } from '../src/managed/trusted-host-store'
import type { MobileConnectionStatus, MobileDeviceCredential } from '../src/managed/types'
import type { HostProfile } from '../src/transport/types'

export default function NativeManagedRoute(): React.JSX.Element {
  const router = useRouter()
  const [activeHost, setActiveHost] = useState<HostProfile | null>(null)
  const [credential, setCredential] = useState<MobileDeviceCredential | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<MobileConnectionStatus>('UNPAIRED')

  useEffect(() => {
    let mounted = true
    async function initHostAndCredential(): Promise<void> {
      try {
        const hosts = await loadHosts()
        if (!mounted) {
          return
        }
        if (hosts.length > 0) {
          const host = hosts[0]
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
  }, [])

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
    if (state.kind !== 'connected') {
      setConnectionStatus(state.kind === 'connecting' ? 'CONNECTING' : 'OFFLINE')
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
  }, [provider, client, state.kind, credential, activeHost])

  const handlePairOrRegister = async () => {
    if (activeHost && client && state.kind === 'connected') {
      try {
        setConnectionStatus('CONNECTING')
        const hostIdentity = (await client.request('managed.getHostIdentity', {})) as {
          fingerprint?: string
          host_fingerprint?: string
          host_id?: string
        }
        const hostFp = hostIdentity?.fingerprint || hostIdentity?.host_fingerprint
        if (!hostFp) {
          throw new Error('HOST_IDENTITY_UNAVAILABLE')
        }
        const devId = `motog20-${Date.now().toString(36)}`
        const regRes = (await client.request('managed.registerDevice', {
          deviceId: devId,
          deviceName: 'Motorola Moto G20',
          clientNonce: `cnonce-${Date.now()}`,
          confirmedFingerprint: hostFp
        })) as { ok: boolean; credential: MobileDeviceCredential }
        if (regRes.ok && regRes.credential) {
          await saveStoredCredential(regRes.credential, activeHost.id)
          setCredential(regRes.credential)
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
