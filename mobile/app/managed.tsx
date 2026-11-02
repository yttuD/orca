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
              return
            }
            const nextSt = await provider.probeAuthentication()
            if (active) {
              setConnectionStatus(nextSt)
              if (nextSt === 'ONLINE' && pollTimer) {
                clearInterval(pollTimer)
                pollTimer = null
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
      }
    }
  }, [provider, client, state.kind, credential, activeHost])

  return (
    <SafeAreaView style={styles.container}>
      <ManagedCenterView
        connectionStatus={connectionStatus}
        dataProvider={provider}
        onBack={() => router.back()}
        onPairPress={() => router.push('/pair')}
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
