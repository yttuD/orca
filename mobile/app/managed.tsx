import React, { useMemo, useEffect, useState } from 'react'
import { SafeAreaView, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { ManagedCenterView } from '../src/managed/ManagedCenterView'
import { EncryptedRpcManagedDataProvider } from '../src/managed/data-provider'
import { useHostClient } from '../src/transport/host-client-hooks'
import type { MobileConnectionStatus, MobileDeviceCredential } from '../src/managed/types'

export default function NativeManagedRoute(): React.JSX.Element {
  const router = useRouter()
  const { client, state } = useHostClient(undefined)
  const [credential] = useState<MobileDeviceCredential | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<MobileConnectionStatus>('UNPAIRED')

  const provider = useMemo(() => {
    if (!client) {
      return undefined
    }
    return new EncryptedRpcManagedDataProvider(client, credential)
  }, [client, credential])

  useEffect(() => {
    if (!provider || !client) {
      setConnectionStatus(credential ? 'OFFLINE' : 'UNPAIRED')
      return
    }
    if (state.kind !== 'connected') {
      setConnectionStatus(state.kind === 'connecting' ? 'CONNECTING' : 'OFFLINE')
      return
    }

    let active = true
    provider.probeAuthentication().then((status) => {
      if (active) {
        setConnectionStatus(status)
      }
    })
    return () => {
      active = false
    }
  }, [provider, client, state.kind, credential])

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
