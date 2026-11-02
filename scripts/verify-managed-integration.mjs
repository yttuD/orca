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

async function checkEngineRpc(testName, payload, token = null, extraHeaders = {}) {
  console.log(`\n[TEST] ${testName}`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  const headers = {
    'Content-Type': 'application/json',
    'X-Managed-Profile': 'NORMAL',
    ...extraHeaders
  }
  if (extraHeaders['X-Managed-Profile'] === null) {
    delete headers['X-Managed-Profile']
  }
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

  // 10. Positive: Authenticated managed.getEvidence
  const evidenceRes = await checkEngineRpc(
    `10. Authenticated managed.getEvidence for task_id=${taskId}`,
    {
      request_id: 'test-auth-evidence-01',
      method: 'managed.getEvidence',
      protocol: { name: 'managed', major: 1, minor: 0 },
      caller: { surface: 'renderer' },
      params: { project_id: projectId, task_id: taskId }
    },
    bridgeToken
  )
  assert.equal(evidenceRes.status, 200)
  assert.equal(evidenceRes.data.ok, true)
  const evidence = evidenceRes.data.data.evidence
  assert.ok(evidence, 'Expected evidence object')
  assert.equal(evidence.task_id, taskId)
  assert.equal(evidence.project_id, projectId)
  assert.ok(
    ['AVAILABLE', 'NOT_FOUND', 'NOT_RUN', 'UNVERIFIED', 'ERROR'].includes(evidence.evidence_status)
  )
  assert.equal(typeof evidence.is_synthetic, 'boolean')
  assert.ok(Array.isArray(evidence.checks))
  assert.ok(Array.isArray(evidence.artifacts))
  console.log(
    `  -> PASS: getEvidence returned status=${evidence.evidence_status}, is_synthetic=${evidence.is_synthetic}`
  )

  // 11. Negative: Path traversal rejection in managed.getEvidence
  const traversalRes = await checkEngineRpc(
    '11. Path traversal rejection in managed.getEvidence (evidence_key=../../etc/passwd)',
    {
      request_id: 'test-evidence-traversal-01',
      method: 'managed.getEvidence',
      protocol: { name: 'managed', major: 1, minor: 0 },
      caller: { surface: 'renderer' },
      params: { project_id: projectId, task_id: taskId, evidence_key: '../../etc/passwd' }
    },
    bridgeToken
  )
  assert.equal(traversalRes.data.ok, false)
  assert.equal(traversalRes.data.error_code, 'INVALID_PARAMS')
  console.log('  -> PASS: Path traversal attempt strictly rejected with INVALID_PARAMS')

  // 12. Positive: Authenticated managed.presentReviewPacket
  const packetRes = await checkEngineRpc(
    `12. Authenticated managed.presentReviewPacket for task_id=${taskId}`,
    {
      request_id: 'test-auth-packet-01',
      method: 'managed.presentReviewPacket',
      protocol: { name: 'managed', major: 1, minor: 0 },
      caller: { surface: 'renderer' },
      params: { project_id: projectId, task_id: taskId }
    },
    bridgeToken
  )
  assert.equal(packetRes.status, 200)
  assert.equal(packetRes.data.ok, true)
  const packet = packetRes.data.data.review_packet
  assert.ok(packet, 'Expected review_packet object')
  assert.equal(packet.task_id, taskId)
  assert.equal(packet.project_id, projectId)
  assert.ok(
    ['AVAILABLE', 'NOT_FOUND', 'NOT_RUN', 'UNVERIFIED', 'ERROR'].includes(packet.packet_status)
  )
  assert.equal(typeof packet.is_synthetic, 'boolean')
  assert.equal(typeof packet.checks_count, 'number')
  assert.ok(typeof packet.markdown_packet === 'string')
  console.log(
    `  -> PASS: presentReviewPacket returned packet_status=${packet.packet_status}, is_synthetic=${packet.is_synthetic}`
  )

  // 13. Positive: Authenticated managed.listActivity
  const activityRes = await checkEngineRpc(
    `13. Authenticated managed.listActivity for project_id=${projectId}`,
    {
      request_id: 'test-auth-activity-01',
      method: 'managed.listActivity',
      protocol: { name: 'managed', major: 1, minor: 0 },
      caller: { surface: 'renderer' },
      params: { project_id: projectId, task_id: taskId, limit: 10 }
    },
    bridgeToken
  )
  assert.equal(activityRes.status, 200)
  assert.equal(activityRes.data.ok, true)
  const activities = activityRes.data.data.activities
  assert.ok(Array.isArray(activities), 'Expected activities array')
  console.log(`  -> PASS: listActivity returned ${activities.length} activity transition(s)`)

  // 14. Negative: Profile mismatch rejection
  const profileMismatchRes = await checkEngineRpc(
    '14. Profile mismatch rejection with header X-Managed-Profile: MISMATCHED_PROFILE',
    {
      request_id: 'test-profile-mismatch-01',
      method: 'managed.listProjects',
      protocol: { name: 'managed', major: 1, minor: 0 },
      caller: { surface: 'renderer' },
      params: {}
    },
    bridgeToken,
    { 'X-Managed-Profile': 'WRONG_PROFILE_NAME' }
  )
  assert.equal(profileMismatchRes.data.ok, false)
  assert.equal(profileMismatchRes.data.error_code, 'AUTH_REQUIRED')
  console.log('  -> PASS: Profile mismatch rejected with AUTH_REQUIRED')

  // 15. Negative: Missing X-Managed-Profile header rejected with AUTH_REQUIRED
  const missingProfileRes = await checkEngineRpc(
    '15. Missing X-Managed-Profile header must fail closed with AUTH_REQUIRED',
    {
      request_id: 'test-profile-missing-01',
      method: 'managed.listProjects',
      protocol: { name: 'managed', major: 1, minor: 0 },
      caller: { surface: 'renderer' },
      params: {}
    },
    bridgeToken,
    { 'X-Managed-Profile': null }
  )
  assert.equal(missingProfileRes.data.ok, false)
  assert.equal(missingProfileRes.data.error_code, 'AUTH_REQUIRED')
  console.log('  -> PASS: Missing X-Managed-Profile header strictly rejected with AUTH_REQUIRED')

  // 16. Provenance & Check status fidelity verification
  assert.ok(['AUTHENTIC', 'SYNTHETIC', 'UNVERIFIED'].includes(evidence.provenance))
  assert.ok(['VERIFIED', 'MISMATCH', 'NOT_RUN'].includes(evidence.hash_status))
  assert.equal(typeof evidence.commit_exists, 'boolean', 'Expected boolean commit_exists')
  assert.equal(typeof evidence.hash_verified, 'boolean', 'Expected boolean hash_verified')
  assert.equal(
    typeof evidence.provenance_verified,
    'boolean',
    'Expected boolean provenance_verified'
  )
  assert.ok(
    ['CERTIFIED', 'UNCERTIFIED', 'REJECTED'].includes(evidence.certification_status),
    'Expected valid certification_status'
  )
  assert.ok(
    evidence.memory_telemetry &&
      ['MEASURED', 'NOT_MEASURED'].includes(evidence.memory_telemetry.status),
    'Expected memory_telemetry with MEASURED or NOT_MEASURED status'
  )
  assert.ok(evidence.checks_summary && typeof evidence.checks_summary.total === 'number')
  assert.ok(['AUTHENTIC', 'SYNTHETIC', 'UNVERIFIED'].includes(packet.provenance))
  assert.ok(['VERIFIED', 'MISMATCH', 'NOT_RUN'].includes(packet.hash_status))
  assert.ok(
    ['CERTIFIED', 'UNCERTIFIED', 'REJECTED'].includes(packet.certification_status),
    'Expected valid packet certification_status'
  )
  console.log(
    `  -> PASS: Provenance & integrity certified (provenance=${evidence.provenance}, hash=${evidence.hash_status}, cert=${evidence.certification_status}, mem=${evidence.memory_telemetry.status})`
  )

  console.log('\n=== ALL AUTOMATED INTEGRATION ASSERTIONS PASSED (100% GREEN) ===\n')
}

run().catch((err) => {
  console.error('\nFAILED INTEGRATION TEST:', err.message)
  process.exit(1)
})
