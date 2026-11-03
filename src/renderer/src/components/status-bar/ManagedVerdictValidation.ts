/**
 * Browser-side schema checks only. The Python engine is the final authority:
 * it independently validates SQLite state, hashes, outbox and operator consent.
 */
export type ArchitectVerdictV1 = {
  protocol_version: 1
  kind: 'verdict'
  project_id: string
  repo_id: string
  task_id: string
  task_sha256: string
  attempt_id: string
  result_sha256: string
  decision: 'ACCEPT' | 'REWORK' | 'BLOCK' | 'NEEDS_HUMAN'
  reason: string
  context_checkpoint_sha256: string
  next_task_id?: string | null
  architect_mode: 'chat'
}

export type ExpectedVerdictBinding = {
  projectId: string
  taskId: string
  repoId?: string | null
  taskSha?: string | null
  resultSha?: string | null
  contextSha?: string | null
  attemptId?: string | null
}

type ParseResult =
  | { ok: true; verdict: ArchitectVerdictV1 }
  | { ok: false; error: string }

const SHA256_RE = /^[0-9a-fA-F]{64}$/
const PROJECT_ID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const TASK_ID_RE = /^[A-Za-z0-9_-]+$/
const ALLOWED_KEYS = new Set([
  'protocol_version', 'kind', 'project_id', 'repo_id', 'task_id',
  'task_sha256', 'attempt_id', 'result_sha256', 'decision', 'reason',
  'context_checkpoint_sha256', 'next_task_id', 'architect_mode'
])
const DECISIONS = new Set(['ACCEPT', 'REWORK', 'BLOCK', 'NEEDS_HUMAN'])

export function parseArchitectVerdictV1(
  text: string,
  expected: ExpectedVerdictBinding
): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'JSON inválido.' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'El veredicto debe ser un objeto JSON.' }
  }
  const r = raw as Record<string, unknown>
  const unknownKeys = Object.keys(r).filter((key) => !ALLOWED_KEYS.has(key))
  if (unknownKeys.length > 0) {
    return { ok: false, error: `Campos no admitidos: ${unknownKeys.join(', ')}.` }
  }
  if (r.protocol_version !== 1 || r.kind !== 'verdict' || r.architect_mode !== 'chat') {
    return { ok: false, error: 'Se requiere protocol_version=1, kind=verdict y architect_mode=chat.' }
  }
  if (typeof r.project_id !== 'string' || !PROJECT_ID_RE.test(r.project_id)) {
    return { ok: false, error: 'project_id debe ser UUID válido.' }
  }
  if (r.project_id !== expected.projectId || r.task_id !== expected.taskId) {
    return { ok: false, error: 'project_id o task_id no corresponde a la revisión actual.' }
  }
  if (typeof r.task_id !== 'string' || !TASK_ID_RE.test(r.task_id)) {
    return { ok: false, error: 'task_id inválido.' }
  }
  if (typeof r.repo_id !== 'string' || !/^\d+$/.test(r.repo_id)) {
    return { ok: false, error: 'repo_id debe ser una cadena numérica.' }
  }
  if (typeof expected.repoId === 'string' && expected.repoId && r.repo_id !== expected.repoId) {
    return { ok: false, error: 'repo_id no coincide con la tarea del backend.' }
  }
  if (typeof r.attempt_id !== 'string' || !TASK_ID_RE.test(r.attempt_id)) {
    return { ok: false, error: 'attempt_id inválido.' }
  }
  if (expected.attemptId && r.attempt_id !== expected.attemptId) {
    return { ok: false, error: 'attempt_id no coincide con la ejecución.' }
  }
  for (const [field, expectedHash] of [
    ['task_sha256', expected.taskSha],
    ['result_sha256', expected.resultSha],
    ['context_checkpoint_sha256', expected.contextSha]
  ] as const) {
    const actual = r[field]
    if (typeof actual !== 'string' || !SHA256_RE.test(actual)) {
      return { ok: false, error: `${field} debe ser SHA-256 hexadecimal de 64 caracteres.` }
    }
    if (expectedHash && actual.toLowerCase() !== expectedHash.toLowerCase()) {
      return { ok: false, error: `${field} difiere del hash provisto por el backend.` }
    }
  }
  if (!DECISIONS.has(String(r.decision))) {
    return { ok: false, error: 'Decisión válida: ACCEPT, REWORK, BLOCK o NEEDS_HUMAN.' }
  }
  if (typeof r.reason !== 'string' || !r.reason.trim()) {
    return { ok: false, error: 'reason es obligatorio para una revisión responsable.' }
  }
  if (
    r.next_task_id !== undefined &&
    r.next_task_id !== null &&
    (typeof r.next_task_id !== 'string' || !TASK_ID_RE.test(r.next_task_id))
  ) {
    return { ok: false, error: 'next_task_id inválido.' }
  }
  return {
    ok: true,
    verdict: {
      protocol_version: 1,
      kind: 'verdict',
      project_id: r.project_id as string,
      repo_id: r.repo_id as string,
      task_id: r.task_id as string,
      task_sha256: r.task_sha256 as string,
      attempt_id: r.attempt_id as string,
      result_sha256: r.result_sha256 as string,
      decision: r.decision as ArchitectVerdictV1['decision'],
      reason: r.reason as string,
      context_checkpoint_sha256: r.context_checkpoint_sha256 as string,
      next_task_id: (r.next_task_id as string | null | undefined) ?? null,
      architect_mode: 'chat'
    }
  }
}
