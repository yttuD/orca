'use strict'

// Windows-only synthetic owner: intentionally killed WITHOUT calling
// job.close() by the Gate 9C test. This process is not Electron or Python.
// It has no network, credentials, repository access or operational motor.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (process.platform !== 'win32' || process.env.ORCA_GATE9C_TEST_ONLY !== '1') {
  process.exit(2)
}

const root = path.resolve(process.argv[2] || '')
const temp = fs.realpathSync(os.tmpdir())
const prefix = temp.endsWith(path.sep) ? temp : temp + path.sep
if (
  !root.toLowerCase().startsWith(prefix.toLowerCase()) ||
  !path.basename(root).toLowerCase().startsWith('orca-gate9c-') ||
  !fs.statSync(root).isDirectory()
) {
  process.exit(3)
}

const addon = require(path.resolve(__dirname, '../../native/windows-security/index.js'))
const worker = path.join(root, 'synthetic-worker.cjs')
const ownerMarker = path.join(root, 'owner.json')
const grandchildMarker = path.join(root, 'grandchild.pid')
if (!fs.statSync(worker).isFile() || fs.existsSync(ownerMarker)) {
  process.exit(4)
}

const quote = (value) => {
  if (value.includes('"') || value.includes('\0')) throw new Error('UNSAFE_QA_ARG')
  return '"' + value + '"'
}
// Never inherit arbitrary environment secrets or credentials.
const envKeys = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'Path', 'PATHEXT']
const minimalEnv = envKeys.flatMap((key) => (
  process.env[key] ? [key + '=' + process.env[key]] : []
))
const block = minimalEnv.join('\0') + '\0\0'

const job = addon.spawnManagedJobContained(
  process.execPath,
  [quote(process.execPath), quote(worker), quote(grandchildMarker)].join(' '),
  root,
  block
)
const rootInfo = job.snapshot()
fs.writeFileSync(ownerMarker, JSON.stringify({
  parentPid: process.pid,
  jobRootPid: rootInfo.pid,
  jobRootCreationTimeTicks: rootInfo.creationTimeTicks
}), { flag: 'wx' })

// Bound the lifetime even if outer QA fails to kill this synthetic owner.
setTimeout(() => {
  job.close()
  process.exit(0)
}, 25000)
