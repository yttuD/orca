import React, { useMemo, useEffect, useState } from 'react'
import { SafeAreaView, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { ManagedCenterView } from '../src/managed/ManagedCenterView'
import { EncryptedRpcManagedDataProvider } from '../src/managed/data-provider'
import { useHostClient } from '../src/transport/host-client-hooks'
import { loadHosts } from '../src/transport/host-store'
import { loadStoredCredential, saveStoredCredential } from '../src/managed/trusted-host-store'
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

          let cred = await loadStoredCredential(host.id)
          if (!cred && host.deviceToken) {
            cred = {
              deviceId: `device-${host.id}`,
              deviceName: host.name || 'Mobile Device',
              deviceToken: host.deviceToken,
              hostId: host.id,
              hostAddress: host.endpoint,
              issuedAt: host.lastConnected || Date.now(),
              expiresAt: (host.lastConnected || Date.now()) + 30 * 24 * 3600 * 1000,
              role: 'MOBILE_READONLY',
              revoked: false,
              nonce: `cred-${host.id}`
            }
            await saveStoredCredential(cred)
          }

          if (mounted && cred) {
            if (cred.revoked || Date.now() > cred.expiresAt) {
              setConnectionStatus('AUTH_REQUIRED')
            } else {
              setConnectionStatus('CONNECTING')
            }
            setCredential(cred)
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
    setConnectionStatus('CONNECTING')
    provider.probeAuthentication().then((status) => {
      if (active) {
        setConnectionStatus(status)
      }
    })
    return () => {
      active = false
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
