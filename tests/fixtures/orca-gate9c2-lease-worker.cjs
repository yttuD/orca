'use strict'

// Gate 9B-C2: dedicated test-only Windows worker. Never starts FastAPI.
// Only a native named mutex is acquired. A 20-second fallback prevents
// persistent test owners after a test runner failure.
if (process.platform !== 'win32' || process.env.ORCA_GATE9C2_TEST_ONLY !== '1') {
  process.exit(2)
}
const mode = process.argv[2]
const identity = process.argv[3]
if (!['hold', 'probe'].includes(mode) || typeof identity !== 'string') process.exit(3)

const addon = require('../../native/windows-security/index.js')
const result = addon.acquireManagedMotorLease(identity)

const done = () => {
  if (result.state === 'ACQUIRED_REQUIRES_RECONCILIATION') result.lease.close()
  process.exit(0)
}

process.stdout.write(JSON.stringify({
  state: result.state,
  profileTag: process.env.ORCA_GATE9C2_PROFILE_TAG || 'none',
  ...(result.state === 'ACQUIRED_REQUIRES_RECONCILIATION'
    ? {
        scope: result.lease.snapshot().scope,
        aclVerified: result.lease.snapshot().aclVerified,
        reconciliationRequired: result.lease.snapshot().reconciliationRequired
      }
    : {})
}) + '\n', () => {
  if (mode !== 'hold' || result.state !== 'ACQUIRED_REQUIRES_RECONCILIATION') {
    done()
    return
  }
  process.on('message', (message) => {
    if (message === 'release') done()
  })
  setTimeout(done, 20000)
})
