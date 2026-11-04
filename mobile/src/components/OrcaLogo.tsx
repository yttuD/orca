import { Image } from 'react-native'

// Export name is intentionally kept as a compatibility alias for existing imports.
// The user-visible icon is the approved Orcastrator neon logo.
type Props = {
  size?: number
  color?: string
}

export function OrcaLogo({ size = 24 }: Props) {
  return (
    <Image
      source={require('../../assets/icon.png')}
      accessibilityLabel="Orcastrator"
      accessibilityRole="image"
      style={{ width: size, height: size, resizeMode: 'contain' }}
    />
  )
}
