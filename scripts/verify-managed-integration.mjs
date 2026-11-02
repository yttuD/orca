import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const PYTHON_BASE_URL = 'http://127.0.0.1:8765'
const PYTHON_RPC_URL = `${PYTHON_BASE_URL}/api/managed/rpc`

function resolveTokenFromPaths(baseNames) {
  const candidates = []
  let currentDir = process.cwd()
  for (let i = 0; i < 4; i++) {
    const searchDirs = [
      currentDir,
      resolve(currentDir, 'workspaces', 'staging'),
      resolve(currentDir, 'ORQUESTADOR-MASTER'),
      resolve(currentDir, 'ORQUESTADOR-MASTER', 'workspaces', 'staging'),
      resolve(currentDir, 'Chat-AGY-CODEX-Orquestador'),
      resolve(currentDir, 'Chat-AGY-CODEX-Orquestador', 'workspaces', 'staging')
    ]
    for (const sDir of searchDirs) {
      for (const name of baseNames) {
        const full = resolve(sDir, name)
        if (existsSync(full)) {
          try {
            const stat = statSync(full)
            candidates.push({ path: full, mtime: stat.mtimeMs })
          } catch {
            // ignore
          }
        }
      }
    }
    const parent = resolve(currentDir, '..')
    if (parent === currentDir) {
      break
    }
    currentDir = parent
  }

  candidates.sort((a, b) => b.mtime - a.mtime)
  for (const c of candidates) {
    try {
      const content = readFileSync(c.path, 'utf8').trim()
      if (content) {
        return content
      }
    } catch {
      // ignore
    }
  }
  return null
}

function resolveBridgeToken() {
  if (process.env.MANAGED_BRIDGE_TOKEN) {
    return process.env.MANAGED_BRIDGE_TOKEN.trim()
  }
  if (process.env.MANAGED_BRIDGE_TOKEN_PATH && existsSync(process.env.MANAGED_BRIDGE_TOKEN_PATH)) {
    try {
      const content = readFileSync(process.env.MANAGED_BRIDGE_TOKEN_PATH, 'utf8').trim()
      if (content) {
        return content
      }
    } catch {
      // ignore
    }
  }

  return resolveTokenFromPaths(['.managed_bridge_token', '.managed_bridge_token_staging'])
}

function resolveOperatorToken() {
  if (process.env.OPERATOR_TOKEN) {
    return process.env.OPERATOR_TOKEN.trim()
  }
  return resolveTokenFromPaths(['.operator_token', '.operator_token_staging'])
}

async function checkEngineRpc(testName, payload, token = null) {
  console.log(`\n[TEST] ${testName}`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  const headers = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const resp = await fetch(PYTHON_RPC_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    }).finally(() => clearTimeout(timeout))

    const data = await resp.json()
    return { status: resp.status, data }
  } catch (err) {
    clearTimeout(timeout)
    throw new Error(`Engine unreachable at ${PYTHON_RPC_URL}: ${err.message}`)
  }
}

async function run() {
  console.log('=== Automated Integration Test: Managed Bridge (ORCA-02B-R1) ===')
  const bridgeToken = resolveBridgeToken()
  assert.ok(
    bridgeToken,
    'Managed bridge token must exist (.managed_bridge_token or MANAGED_BRIDGE_TOKEN)'
  )
  console.log('Resolved Managed Bridge Token: FOUND (masked)')

  // 1. Negative: Unauthenticated request must fail closed with AUTH_REQUIRED
  const unauthRes = await checkEngineRpc(
    '1. Unauthenticated managed.listProjects (Must fail closed with AUTH_REQUIRED)',
    {
      request_id: 'test-unauth-01',
      method: 'managed.listProjects',
      protocol: { name: 'managed', major: 1, minor: 0 },
      caller: { surface: 'renderer', authenticated: false, capabilities: ['VIEW'] },
      params: {}
    },
    null
  )
  assert.equal(unauthRes.status, 200)
  assert.equal(unauthRes.data.ok, false)
  assert.equal(unauthRes.data.error_code, 'AUTH_REQUIRED')
  assert.equal(unauthRes.data.effects_applied, false)
  assert.equal(unauthRes.data.engine_state_unchanged, true)
  console.log('  -> PASS: Unauthenticated call rejected with AUTH_REQUIRED')

  // 2. Negative: Bridge token CANNOT unlock operator administration panel
  console.log('\n[TEST] 2. Separation of Duties: Bridge token cannot unlock operator admin')
  const adminUnlockResp = await fetch(`${PYTHON_BASE_URL}/api/auth/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: bridgeToken })
  })
  assert.equal(
    adminUnlockResp.status,
    401,
    'Expected HTTP 401 Unauthorized when attempting admin unlock with bridge token'
  )
  console.log('  -> PASS: Operator panel strictly rejected bridge token with HTTP 401')

  // 3. Negative: Operator token CANNOT authenticate Managed bridge
  const operatorToken = resolveOperatorToken()
  if (operatorToken) {
    console.log('\n[TEST] 3. Separation of Duties: Operator token cannot authenticate bridge')
    const opBridgeRes = await checkEngineRpc(
      '3. Calling managed.listProjects with operator admin token',
      {
        request_id: 'test-op-tok-on-bridge',
        method: 'managed.listProjects',
        protocol: { name: 'managed', major: 1, minor: 0 },
        caller: { surface: 'renderer' },
        params: {}
      },
      operatorToken
    )
    assert.equal(opBridgeRes.data.ok, false)
    assert.equal(opBridgeRes.data.error_code, 'AUTH_REQUIRED')
    console.log('  -> PASS: Operator token strictly rejected on Managed bridge')
  }

  // 4. Positive: Authenticated listProjects with bridge token
  const listRes = await checkEngineRpc(
    '4. Authenticated managed.listProjects with valid bridge token',
    {
      request_id: 'test-auth-list-01',
      method: 'managed.listProjects',
      protocol: { name: 'managed', major: 1, minor: 0 },
      caller: { surface: 'renderer' },
      params: {}
    },
    bridgeToken
  )
  assert.equal(listRes.status, 200)
  assert.equal(listRes.data.ok, true)
  assert.equal(listRes.data.effects_applied, false)
  assert.equal(listRes.data.engine_state_unchanged, true)
  const projects = listRes.data.data.projects
  assert.ok(Array.isArray(projects) && projects.length > 0, 'Expected non-empty projects array')
  const p0 = projects[0]
  assert.ok(p0.id && p0.name, 'Project must contain id and name')
  assert.equal('root_dir' in p0, false, 'Leaked root_dir in project projection')
  assert.equal('data_dir' in p0, false, 'Leaked data_dir in project projection')
  assert.equal('operator_token' in p0, false, 'Leaked operator_token in project projection')
  console.log(`  -> PASS: listProjects returned ${projects.length} projected sanitized project(s)`)

  const projectId = p0.id

  // 5. Positive: Authenticated listTasks
  const tasksRes = await checkEngineRpc(
    `5. Authenticated managed.listTasks for project_id=${projectId}`,
    {
      request_id: 'test-auth-tasks-01',
      method: 'managed.listTasks',
      protocol: { name: 'managed', major: 1, minor: 0 },
      caller: { surface: 'renderer' },
      params: { project_id: projectId }
    },
    bridgeToken
  )
  assert.equal(tasksRes.status, 200)
  assert.equal(tasksRes.data.ok, true)
  const tasks = tasksRes.data.data.tasks
  assert.ok(Array.isArray(tasks) && tasks.length > 0, 'Expected non-empty tasks array')
  const t0 = tasks[0]
  assert.ok(t0.id && t0.status, 'Task must contain id and status')
  assert.equal('worktree_dir' in t0, false, 'Leaked worktree_dir in task projection')
  assert.equal('git_env' in t0, false, 'Leaked git_env in task projection')
  console.log(`  -> PASS: listTasks returned ${tasks.length} projected sanitized task(s)`)

  const taskId = t0.id

  // 6. Positive: Authenticated getExecution (real task)
  const execRes = await checkEngineRpc(
    `6. Authenticated managed.getExecution for task_id=${taskId}`,
    {
      request_id: 'test-auth-exec-real',
      method: 'managed.getExecution',
      protocol: { name: 'managed', major: 1, minor: 0 },
      caller: { surface: 'renderer' },
      params: { project_id: projectId, task_id: taskId }
    },
    bridgeToken
  )
  assert.equal(execRes.status, 200)
  assert.equal(execRes.data.ok, true)
  const execution = execRes.data.data.execution
  assert.equal(execution.task_id, taskId)
  assert.equal(execution.project_id, projectId)
  assert.ok(execution.status, 'Execution must contain status')
  assert.ok('lease_owner' in execution, 'Execution must contain lease_owner')
  assert.ok('lease_generation' in execution, 'Execution must contain lease_generation')
  console.log('  -> PASS: getExecution returned valid sanitized execution details')

  // 7. Negative: Cross-project task isolation
  const crossRes = await checkEngineRpc(
    '7. Project boundary isolation: query task under mismatched project_id',
    {
      request_id: 'test-auth-exec-cross',
      method: 'managed.getExecution',
      protocol: { name: 'managed', major: 1, minor: 0 },
      caller: { surface: 'renderer' },
      params: { project_id: 'c0a80101-0000-4000-8000-NONEXISTENT', task_id: taskId }
    },
    bridgeToken
  )
  assert.equal(crossRes.data.ok, false)
  assert.equal(crossRes.data.error_code, 'NOT_FOUND')
  console.log('  -> PASS: Cross-project task access correctly denied with NOT_FOUND')

  // 8. Negative: Missing parameters for getExecution
  const missingParamsRes = await checkEngineRpc(
    '8. Parameter validation: managed.getExecution missing task_id',
    {
      request_id: 'test-auth-exec-missing',
      method: 'managed.getExecution',
      protocol: { name: 'managed', major: 1, minor: 0 },
      caller: { surface: 'renderer' },
      params: { project_id: projectId }
    },
    bridgeToken
  )
  assert.equal(missingParamsRes.data.ok, false)
  assert.equal(missingParamsRes.data.error_code, 'INVALID_PARAMS')
  console.log('  -> PASS: Missing parameters correctly rejected with INVALID_PARAMS')

  // 9. Negative: Mutation method rejection
  const mutRes = await checkEngineRpc(
    '9. Mutation rejection: managed.requestDispatch in read-only mode',
    {
      request_id: 'test-auth-mut-01',
      method: 'managed.requestDispatch',
      protocol: { name: 'managed', major: 1, minor: 0 },
      caller: { surface: 'renderer', capabilities: ['VIEW', 'MUTATE'] },
      params: {}
    },
    bridgeToken
  )
  assert.equal(mutRes.data.ok, false)
  assert.equal(mutRes.data.error_code, 'READ_ONLY_WORKSPACE')
  assert.equal(mutRes.data.effects_applied, false)
  assert.equal(mutRes.data.engine_state_unchanged, true)
  console.log('  -> PASS: Mutation request rejected with READ_ONLY_WORKSPACE')

  console.log('\n=== ALL AUTOMATED INTEGRATION ASSERTIONS PASSED (100% GREEN) ===\n')
}

run().catch((err) => {
  console.error('\nFAILED INTEGRATION TEST:', err.message)
  process.exit(1)
})
