import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PYTHON_RPC_URL = 'http://127.0.0.1:8765/api/managed/rpc'

function resolveBridgeToken() {
  if (process.env.ORCHESTRATOR_TOKEN) {
    return process.env.ORCHESTRATOR_TOKEN.trim()
  }
  if (process.env.OPERATOR_TOKEN) {
    return process.env.OPERATOR_TOKEN.trim()
  }
  const candidatePaths = [
    join(process.cwd(), '.operator_token'),
    resolve(process.cwd(), '../ORQUESTADOR-MASTER/.operator_token'),
    'D:/Programacion-Cosas/ORQUESTADOR-MASTER/.operator_token',
    'D:\\Programacion-Cosas\\ORQUESTADOR-MASTER\\.operator_token'
  ]
  for (const p of candidatePaths) {
    try {
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf8').trim()
        if (content) {
          return content
        }
      }
    } catch {
      // ignore
    }
  }
  return null
}

async function checkEngine(testName, payload, token = null) {
  console.log(`\n--- Test: ${testName} ---`)
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)

    const headers = { 'Content-Type': 'application/json' }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const resp = await fetch(PYTHON_RPC_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    }).finally(() => clearTimeout(timeout))

    const data = await resp.json()
    console.log(`HTTP Status: ${resp.status}`)
    console.log('Response:', JSON.stringify(data, null, 2))
    return { ok: true, data }
  } catch (err) {
    console.log(`Connection failed: ${err.message}`)
    return { ok: false, error: 'ENGINE_OFFLINE' }
  }
}

async function run() {
  console.log('=== Checking Managed Integration (ORCA-02B) ===')
  const token = resolveBridgeToken()
  console.log(`Resolved local bridge token: ${token ? 'FOUND (masked)' : 'NONE'}`)

  // 1. Unauthenticated request (must fail with AUTH_REQUIRED if engine is online)
  const unauthReq = {
    request_id: 'test-unauth-01',
    method: 'managed.listProjects',
    protocol: { name: 'managed', major: 1, minor: 0 },
    caller: { surface: 'renderer', authenticated: false, capabilities: ['VIEW'] },
    params: {}
  }
  const _unauthRes = await checkEngine(
    'Unauthenticated managed.listProjects (Must be AUTH_REQUIRED)',
    unauthReq,
    null
  )

  // 2. Authenticated listProjects
  const listReq = {
    request_id: 'test-auth-list-01',
    method: 'managed.listProjects',
    protocol: { name: 'managed', major: 1, minor: 0 },
    caller: { surface: 'renderer', authenticated: true, capabilities: ['VIEW'] },
    params: {}
  }
  const listRes = await checkEngine('Authenticated managed.listProjects', listReq, token)

  let firstProjectId = null
  if (
    listRes.ok &&
    listRes.data &&
    listRes.data.data &&
    Array.isArray(listRes.data.data.projects) &&
    listRes.data.data.projects.length > 0
  ) {
    firstProjectId = listRes.data.data.projects[0].id
  }

  // 3. Authenticated listTasks
  const tasksReq = {
    request_id: 'test-auth-tasks-01',
    method: 'managed.listTasks',
    protocol: { name: 'managed', major: 1, minor: 0 },
    caller: { surface: 'renderer', authenticated: true, capabilities: ['VIEW'] },
    params: firstProjectId ? { project_id: firstProjectId } : {}
  }
  await checkEngine(
    `Authenticated managed.listTasks (project_id=${firstProjectId || 'all'})`,
    tasksReq,
    token
  )

  // 4. Authenticated getExecution (real task)
  const realExecReq = {
    request_id: 'test-auth-exec-real',
    method: 'managed.getExecution',
    protocol: { name: 'managed', major: 1, minor: 0 },
    caller: { surface: 'renderer', authenticated: true, capabilities: ['VIEW'] },
    params: {
      project_id: 'c0a80101-0000-4000-8000-000000000001',
      task_id: 'TASK-F-CHAT-01-SYNTHETIC'
    }
  }
  await checkEngine('Authenticated managed.getExecution (real task)', realExecReq, token)

  // 4b. Authenticated getExecution (negative test: invalid params if missing)
  const execReq = {
    request_id: 'test-auth-exec-01',
    method: 'managed.getExecution',
    protocol: { name: 'managed', major: 1, minor: 0 },
    caller: { surface: 'renderer', authenticated: true, capabilities: ['VIEW'] },
    params: { project_id: firstProjectId || 'fake-proj', task_id: 'fake-task' }
  }
  await checkEngine(
    'Authenticated managed.getExecution (non-existent task returns NOT_FOUND)',
    execReq,
    token
  )

  // 5. Mutation method rejection
  const mutReq = {
    request_id: 'test-auth-mut-01',
    method: 'managed.requestDispatch',
    protocol: { name: 'managed', major: 1, minor: 0 },
    caller: { surface: 'renderer', authenticated: true, capabilities: ['VIEW'] },
    params: {}
  }
  await checkEngine(
    'Authenticated mutation managed.requestDispatch (must be READ_ONLY_WORKSPACE)',
    mutReq,
    token
  )
}

run()
