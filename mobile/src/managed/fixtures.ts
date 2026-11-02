import type {
  ManagedProjectDTO,
  ManagedTaskDTO,
  ManagedExecutionDTO,
  ManagedEvidenceDTO,
  ManagedActivityItemDTO
} from './types'

export const SYNTHETIC_MANAGED_PROJECTS: readonly ManagedProjectDTO[] = [
  {
    id: 'c0a80101-0000-4000-8000-000000000001',
    name: 'Chat-AGY-CODEX-Orquestador',
    description: 'Motor orquestador supervisado con Jobs Win32 y paridad canónica',
    status: 'ACTIVE',
    mode: 'MANAGED',
    created_at: '2026-10-27T11:03:43.952448+00:00',
    updated_at: '2026-11-01T22:42:00.000000+00:00'
  },
  {
    id: 'c0a80101-0000-4000-8000-000000000002',
    name: 'Marketplace-Inmobiliario',
    description: 'Plataforma inmobiliaria con arquitectura hexagonal y verificación formal',
    status: 'ACTIVE',
    mode: 'MANAGED',
    created_at: '2026-10-28T09:15:00.000000+00:00',
    updated_at: '2026-11-01T20:30:00.000000+00:00'
  }
]

export const SYNTHETIC_MANAGED_TASKS: Record<string, readonly ManagedTaskDTO[]> = {
  'c0a80101-0000-4000-8000-000000000001': [
    {
      id: 'TASK-F-CHAT-01-SYNTHETIC',
      project_id: 'c0a80101-0000-4000-8000-000000000001',
      title: 'Validación de Integridad y Fidelidad de Checks',
      status: 'COMPLETED',
      executor: 'CODEX',
      created_at: '2026-10-27T11:11:15.967948+00:00',
      updated_at: '2026-11-01T22:38:00.000000+00:00'
    },
    {
      id: 'TASK-F-CHAT-02-AUTHENTIC',
      project_id: 'c0a80101-0000-4000-8000-000000000001',
      title: 'Comprobación de Seguridad de Tokens y Memoria P0',
      status: 'COMPLETED',
      executor: 'CODEX',
      created_at: '2026-10-28T14:00:00.000000+00:00',
      updated_at: '2026-11-01T21:00:00.000000+00:00'
    },
    {
      id: 'TASK-F-CHAT-03-ZERO-CHECKS',
      project_id: 'c0a80101-0000-4000-8000-000000000001',
      title: 'Prueba Negativa: Tarea sin Verificaciones Registradas',
      status: 'COMPLETED',
      executor: 'CODEX',
      created_at: '2026-10-29T10:00:00.000000+00:00',
      updated_at: '2026-10-29T10:05:00.000000+00:00'
    }
  ],
  'c0a80101-0000-4000-8000-000000000002': [
    {
      id: 'TASK-INMOB-01-AUTH',
      project_id: 'c0a80101-0000-4000-8000-000000000002',
      title: 'Autenticación JWT y Roles de Gestor',
      status: 'QUEUED',
      executor: 'CODEX',
      created_at: '2026-10-28T09:30:00.000000+00:00',
      updated_at: '2026-10-28T09:30:00.000000+00:00'
    }
  ]
}

export const SYNTHETIC_MANAGED_EXECUTIONS: Record<string, ManagedExecutionDTO> = {
  'TASK-F-CHAT-01-SYNTHETIC': {
    task_id: 'TASK-F-CHAT-01-SYNTHETIC',
    project_id: 'c0a80101-0000-4000-8000-000000000001',
    status: 'COMPLETED',
    executor: 'CODEX',
    attempt_id: 'ATT-001',
    lease_owner: 'orchestrator-worker',
    lease_generation: 1,
    last_activity: '2026-11-01T22:38:00.000000+00:00',
    verdict: 'REJECTED'
  },
  'TASK-F-CHAT-02-AUTHENTIC': {
    task_id: 'TASK-F-CHAT-02-AUTHENTIC',
    project_id: 'c0a80101-0000-4000-8000-000000000001',
    status: 'COMPLETED',
    executor: 'CODEX',
    attempt_id: 'ATT-002',
    lease_owner: 'orchestrator-worker',
    lease_generation: 2,
    last_activity: '2026-11-01T21:00:00.000000+00:00',
    verdict: 'APPROVED'
  }
}

export const SYNTHETIC_MANAGED_EVIDENCE: Record<string, ManagedEvidenceDTO> = {
  'TASK-F-CHAT-01-SYNTHETIC': {
    project_id: 'c0a80101-0000-4000-8000-000000000001',
    task_id: 'TASK-F-CHAT-01-SYNTHETIC',
    attempt_id: 'ATT-001',
    evidence_status: 'AVAILABLE',
    provenance: 'UNVERIFIED',
    provenance_verified: false,
    commit_exists: false,
    hash_status: 'MISMATCH',
    hash_verified: false,
    certification_status: 'REJECTED',
    execution_mode: 'REAL',
    is_synthetic: false,
    checks_summary: { passed: 2, failed: 1, total: 4 },
    checks: [
      { name: 'test_auth_bridge_security', status: 'PASS', exit_code: 0 },
      { name: 'test_evidence_provenance_check', status: 'FAIL', exit_code: 1 },
      { name: 'test_differential_parity', status: 'SKIPPED', exit_code: null },
      { name: 'test_payload_size_limit', status: 'PASS', exit_code: 0 }
    ],
    artifacts: ['result_trace.log'],
    canonical_sha256: 'b02f644e28cd9258cea5212adda49a0af23ee9d6df1e134ea84b1ed31597cf57',
    result_sha: 'ffffffffffffffffffffffffffffffffffffffff',
    memory_telemetry: { status: 'NOT_MEASURED', peak_rss_bytes: null }
  },
  'TASK-F-CHAT-02-AUTHENTIC': {
    project_id: 'c0a80101-0000-4000-8000-000000000001',
    task_id: 'TASK-F-CHAT-02-AUTHENTIC',
    attempt_id: 'ATT-002',
    evidence_status: 'AVAILABLE',
    provenance: 'AUTHENTIC',
    provenance_verified: true,
    commit_exists: true,
    hash_status: 'VERIFIED',
    hash_verified: true,
    certification_status: 'CERTIFIED',
    execution_mode: 'REAL',
    is_synthetic: false,
    checks_summary: { passed: 3, failed: 0, total: 3 },
    checks: [
      { name: 'test_job_memory_limit', status: 'PASS', exit_code: 0 },
      { name: 'test_node_heap_ceiling', status: 'PASS', exit_code: 0 },
      { name: 'test_crypto_pairing_flow', status: 'PASS', exit_code: 0 }
    ],
    artifacts: ['memory_audit.json'],
    canonical_sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef',
    result_sha: '530fd4cc416820b8e5b322f374cdd6ac1346bf8f',
    memory_telemetry: { status: 'MEASURED', peak_rss_bytes: 482344960 }
  },
  'TASK-F-CHAT-03-ZERO-CHECKS': {
    project_id: 'c0a80101-0000-4000-8000-000000000001',
    task_id: 'TASK-F-CHAT-03-ZERO-CHECKS',
    attempt_id: 'ATT-003',
    evidence_status: 'AVAILABLE',
    provenance: 'UNVERIFIED',
    provenance_verified: false,
    commit_exists: true,
    hash_status: 'VERIFIED',
    hash_verified: true,
    certification_status: 'UNCERTIFIED',
    execution_mode: 'REAL',
    is_synthetic: false,
    checks_summary: { passed: 0, failed: 0, total: 0 },
    checks: [],
    artifacts: [],
    canonical_sha256: null,
    result_sha: '1a7a01b5175955f6d2c7642da7c64d6e3e3b356a',
    memory_telemetry: { status: 'NOT_MEASURED', peak_rss_bytes: null }
  }
}

export const SYNTHETIC_MANAGED_ACTIVITIES: Record<string, readonly ManagedActivityItemDTO[]> = {
  'c0a80101-0000-4000-8000-000000000001': [
    {
      id: 1,
      task_id: 'TASK-F-CHAT-01-SYNTHETIC',
      from_state: 'DRAFT',
      to_state: 'PENDING',
      reason: 'Draft prepared and queued by operator',
      timestamp: '2026-10-27T11:11:15Z'
    },
    {
      id: 2,
      task_id: 'TASK-F-CHAT-01-SYNTHETIC',
      from_state: 'PENDING',
      to_state: 'RUNNING',
      reason: 'Lease acquired by orchestrator worker',
      timestamp: '2026-10-27T11:11:16Z'
    },
    {
      id: 3,
      task_id: 'TASK-F-CHAT-01-SYNTHETIC',
      from_state: 'RUNNING',
      to_state: 'COMPLETED',
      reason: 'Execution completed with check results',
      timestamp: '2026-10-27T11:11:17Z'
    }
  ]
}
