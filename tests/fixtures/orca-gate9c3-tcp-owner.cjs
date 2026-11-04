'use strict'

// ORCA-D02 Gate 9B-C3-B. Disposable read-only census fixture.
// Binds only a kernel-selected ephemeral 127.0.0.1 port. No FastAPI,
// WCB, credentials, existing motor port or background automation.
if (process.platform !== 'win32' || process.env.ORCA_GATE9C3_TEST_ONLY !== '1') {
  process.exit(2)
}
const net = require('node:net')
const server = net.createServer((socket) => socket.destroy())
const halt = () => server.close(() => process.exit(0))
server.on('error', (error) => {
  process.stderr.write('GATE9C3_TEST_LISTENER_ERROR ' + error.code + '\n')
  process.exit(3)
})
process.on('message', (message) => {
  if (message === 'close') halt()
})
server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (!address || typeof address === 'string') return process.exit(4)
  process.stdout.write(JSON.stringify({
    port: address.port,
    pid: process.pid
  }) + '\n')
})
setTimeout(halt, 20000)
