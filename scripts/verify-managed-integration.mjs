const PYTHON_RPC_URL = 'http://127.0.0.1:8765/api/managed/rpc'

async function checkEngine(testName, payload) {
  console.log(`\n--- Test: ${testName} ---`)
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1500)

    const resp = await fetch(PYTHON_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    }).finally(() => clearTimeout(timeout))

    const data = await resp.json()
    console.log(`Status: ${resp.status}`)
    console.log('Response:', JSON.stringify(data, null, 2))
    return { ok: true, data }
  } catch (err) {
    console.log(`Connection failed: ${err.message}`)
    return { ok: false, error: 'ENGINE_OFFLINE' }
  }
}

async function run() {
  console.log('=== Checking Managed Integration ===')

  // 1. Check while engine might be offline or online
  const listReq = {
    request_id: 'test-node-list-01',
    method: 'managed.listProjects',
    protocol: { name: 'managed', major: 1, minor: 0 },
    caller: { surface: 'renderer', authenticated: true, capabilities: ['VIEW'] },
    params: {}
  }
  const _res1 = await checkEngine('managed.listProjects', listReq)

  // 2. Check mutation rejection
  const mutReq = {
    request_id: 'test-node-mut-01',
    method: 'managed.requestDispatch',
    protocol: { name: 'managed', major: 1, minor: 0 },
    caller: { surface: 'renderer', authenticated: true, capabilities: ['VIEW'] },
    params: {}
  }
  const _res2 = await checkEngine('managed.requestDispatch (must be rejected)', mutReq)
}

run()
