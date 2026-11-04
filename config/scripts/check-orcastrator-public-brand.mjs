/**
 * Orcastrator public-brand regression gate (read-only, offline).
 * Intentionally leaves inherited protocol IDs, package names, CLI bins,
 * bundle identifiers and repository paths unchanged until migration gates exist.
 * Run: node config/scripts/check-orcastrator-public-brand.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export function auditPublicBrand(readText) {
  const failures = []
  let checks = 0
  const requireText = (path, label, test) => {
    checks++
    try {
      if (!test(readText(path))) failures.push(`${path}: ${label}`)
    } catch {
      failures.push(`${path}: ${label} (missing or unreadable)`)
    }
  }
  const requireJson = (path, label, test) => {
    requireText(path, label, (source) => test(JSON.parse(source)))
  }

  requireText('README.md', 'public product heading', (s) =>
    /^# Orcastrator\s*$/m.test(s) &&
    !/onorca\.dev|Download Orca|github\.com\/stablyai\/orca\/releases/i.test(s))
  requireText('src/renderer/index.html', 'window title', (s) =>
    /<title>Orcastrator<\/title>/.test(s))
  requireText('config/electron-builder.config.cjs', 'packager productName', (s) =>
    /productName:\s*['"]Orcastrator['"]/.test(s))
  requireText('config/electron-builder.config.cjs', 'Windows executable and installer', (s) =>
    /executableName:\s*['"]Orcastrator['"]/.test(s) &&
    /artifactName:\s*['"]Orcastrator-Windows-Setup\.\$\{ext\}['"]/.test(s) &&
    /shortcutName:\s*['"]\$\{productName\}['"]/.test(s))
  requireText('config/electron-builder.config.cjs', 'public protocol name', (s) =>
    /protocols:\s*\[\{\s*name:\s*['"]Orcastrator['"]/.test(s))
  requireJson('package.json', 'package description', (p) =>
    typeof p.description === 'string' && p.description.startsWith('Orcastrator'))
  requireJson('mobile/app.json', 'Expo public name', (p) =>
    p.expo?.name === 'Orcastrator')
  requireJson('mobile/app.json', 'mobile launch assets', (p) =>
    p.expo?.icon === './assets/icon.png' &&
    p.expo?.splash?.image === './assets/splash-icon.png' &&
    p.expo?.android?.adaptiveIcon?.foregroundImage === './assets/adaptive-icon.png')
  requireJson('mobile/locales/en.json', 'English iOS permission text', (p) =>
    Object.values(p.ios ?? {}).every((s) => typeof s === 'string' && s.includes('Orcastrator')) &&
    Object.keys(p.ios ?? {}).length >= 3)
  requireJson('mobile/locales/es.json', 'Spanish iOS permission text', (p) =>
    Object.values(p.ios ?? {}).every((s) => typeof s === 'string' && s.includes('Orcastrator')) &&
    Object.keys(p.ios ?? {}).length >= 3)
  requireText('mobile/src/components/OrcaLogo.tsx', 'visible logo accessibility name', (s) =>
    /accessibilityLabel=['"]Orcastrator['"]/.test(s))

  return { status: failures.length ? 'FAIL' : 'PASS_STATIC_ONLY', checks, failures }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditPublicBrand((path) => readFileSync(join(ROOT, path), 'utf8'))
  console.log(JSON.stringify(result))
  if (result.failures.length) process.exitCode = 1
}
