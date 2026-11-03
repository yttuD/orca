import { describe, expect, it } from 'vitest'
import { parseArchitectVerdictV1 } from './ManagedVerdictValidation'
import { manualVerdictAuditMode } from './ManagedChatProvider'

const expected = {
  projectId: '11111111-1111-4111-8111-111111111111',
  taskId: 'TASK-001',
  repoId: '1001',
  taskSha: 'a'.repeat(64),
  resultSha: 'b'.repeat(64),
  contextSha: 'c'.repeat(64),
  attemptId: 'ATT-001'
}

const valid = {
  protocol_version: 1,
  kind: 'verdict',
  project_id: expected.projectId,
  repo_id: expected.repoId,
  task_id: expected.taskId,
  task_sha256: expected.taskSha,
  attempt_id: expected.attemptId,
  result_sha256: expected.resultSha,
  decision: 'BLOCK',
  reason: 'Requiere evidencia adicional y revisión humana.',
  context_checkpoint_sha256: expected.contextSha,
  architect_mode: 'chat'
}

const parse = (v: unknown) => parseArchitectVerdictV1(JSON.stringify(v), expected)

describe('manual ArchitectVerdictV1 validation', () => {
  it('accepts complete, bound V1', () => {
    const result = parse(valid)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.verdict.decision).toBe('BLOCK')
  })
  it.each(['ACCEPT', 'REWORK', 'BLOCK', 'NEEDS_HUMAN'])(
    'supports backend decision %s',
    (decision) => expect(parse({ ...valid, decision }).ok).toBe(true)
  )
  it.each(['REJECT', 'COMPLETED', 'APPROVED'])(
    'rejects non-protocol decision %s',
    (decision) => expect(parse({ ...valid, decision }).ok).toBe(false)
  )
  it.each(['repo_id', 'task_sha256', 'attempt_id', 'result_sha256', 'context_checkpoint_sha256'])(
    'rejects missing field %s',
    (key) => {
      const candidate = { ...valid } as Record<string, unknown>
      delete candidate[key]
      expect(parse(candidate).ok).toBe(false)
    }
  )
  it('rejects wrong project, task and hashes', () => {
    expect(parse({ ...valid, project_id: '22222222-2222-4222-8222-222222222222' }).ok).toBe(false)
    expect(parse({ ...valid, task_id: 'OTHER' }).ok).toBe(false)
    expect(parse({ ...valid, context_checkpoint_sha256: 'd'.repeat(64) }).ok).toBe(false)
    expect(parse({ ...valid, task_sha256: 'f'.repeat(64) }).ok).toBe(false)
    expect(parse({ ...valid, result_sha256: '0'.repeat(64) }).ok).toBe(false)
    expect(parse({ ...valid, attempt_id: 'ATT-002' }).ok).toBe(false)
  })
  it('rejects unknown fields, malformed JSON, and non-chat mode', () => {
    expect(parse({ ...valid, api_key: 'not-allowed' }).ok).toBe(false)
    expect(parseArchitectVerdictV1('{', expected).ok).toBe(false)
    expect(parse({ ...valid, architect_mode: 'api' }).ok).toBe(false)
  })
  it('records provider as operator attestation, not verified identity', () => {
    expect(manualVerdictAuditMode('chatgpt_chat')).toContain('OPERATOR_ATTESTED')
    expect(manualVerdictAuditMode('venice_chat')).toContain('OPERATOR_ATTESTED')
    expect(manualVerdictAuditMode('chatgpt_chat')).not.toContain('VERIFIED')
  })
})
