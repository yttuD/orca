import React from 'react'
import { SafeAreaView, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { ManagedCenterView } from '../src/managed/ManagedCenterView'

export default function NativeManagedRoute(): React.JSX.Element {
  const router = useRouter()
  return (
    <SafeAreaView style={styles.container}>
      <ManagedCenterView onBack={() => router.back()} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b'
  }
})
