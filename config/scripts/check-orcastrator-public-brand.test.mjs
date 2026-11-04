import test from 'node:test'
import assert from 'node:assert/strict'
import { auditPublicBrand } from './check-orcastrator-public-brand.mjs'

const sources = {
  'README.md': '# Orcastrator\n\nIdentidad original, MIT.',
  'src/renderer/index.html': '<title>Orcastrator</title>',
  'config/electron-builder.config.cjs': "productName: 'Orcastrator', protocols: [{ name: 'Orcastrator', schemes: ['orca'] }], executableName: 'Orcastrator', artifactName: 'Orcastrator-Windows-Setup.${ext}', shortcutName: '${productName}'",
  'package.json': JSON.stringify({ name: 'orca', description: 'Orcastrator — orquestador' }),
  'mobile/app.json': JSON.stringify({ expo: { name: 'Orcastrator', icon: './assets/icon.png', splash: { image: './assets/splash-icon.png' }, android: { adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png' } }, scheme: 'orca' } }),
  'mobile/locales/en.json': JSON.stringify({ ios: { a: 'Orcastrator camera', b: 'Orcastrator network', c: 'Orcastrator microphone' } }),
  'mobile/locales/es.json': JSON.stringify({ ios: { a: 'Cámara Orcastrator', b: 'Red Orcastrator', c: 'Micrófono Orcastrator' } }),
  'mobile/src/components/OrcaLogo.tsx': '<Image accessibilityLabel="Orcastrator" />'
}
const reader = (files) => (path) => {
  if (!(path in files)) throw new Error('missing fixture')
  return files[path]
}

test('static brand gate accepts public Orcastrator with inherited technical IDs', () => {
  const result = auditPublicBrand(reader(sources))
  assert.equal(result.status, 'PASS_STATIC_ONLY')
  assert.equal(result.checks, 11)
  assert.deepEqual(result.failures, [])
})

test('static brand gate rejects old public heading and upstream download links', () => {
  const result = auditPublicBrand(reader({ ...sources, 'README.md': '# Orca\nDownload Orca at onorca.dev' }))
  assert.equal(result.status, 'FAIL')
  assert.match(result.failures.join(' '), /README\.md/)
})

test('static brand gate rejects old Expo name while allowing old scheme', () => {
  const oldExpo = JSON.parse(sources['mobile/app.json'])
  const changed = { ...sources, 'mobile/app.json': JSON.stringify({ ...oldExpo, expo: { ...oldExpo.expo, name: 'Orca' } }) }
  const result = auditPublicBrand(reader(changed))
  assert.equal(result.status, 'FAIL')
  assert.match(result.failures.join(' '), /Expo public name/)
})
