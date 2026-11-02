export type ManagedProjectDTO = {
  readonly id: string
  readonly name: string
  readonly description?: string | null
  readonly status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'UNKNOWN'
  readonly mode: 'MANAGED' | 'FREE' | 'LOCAL'
  readonly created_at?: string | null
  readonly updated_at?: string | null
}

export type ManagedTaskDTO = {
  readonly id: string
  readonly project_id: string
  readonly title: string
  readonly status: string
  readonly executor: string
  readonly created_at?: string | null
  readonly updated_at?: string | null
}

export type ManagedExecutionDTO = {
  readonly task_id: string
  readonly project_id: string
  readonly status: string
  readonly executor: string
  readonly attempt_id?: string | null
  readonly lease_owner: string
  readonly lease_generation: number
  readonly last_activity?: string | null
  readonly verdict?: string | null
}

export type ManagedEvidenceItem = {
  readonly id: string
  readonly kind: string
  readonly name?: string
  readonly status: string
  readonly count?: number
  readonly summary?: string
}

export type ManagedCheckDTO = {
  readonly name: string
  readonly status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN' | 'SKIPPED' | 'ERROR' | string
  readonly exit_code?: number | null
}

export type ManagedChecksSummary = {
  readonly passed: number
  readonly failed: number
  readonly total: number
}

export type ManagedEvidenceDTO = {
  readonly project_id: string
  readonly task_id: string
  readonly attempt_id?: string | null
  readonly evidence_status: 'AVAILABLE' | 'NOT_FOUND' | 'NOT_RUN' | 'UNVERIFIED' | 'ERROR'
  readonly provenance: 'AUTHENTIC' | 'SYNTHETIC' | 'UNVERIFIED' | string
  readonly hash_status: 'VERIFIED' | 'MISMATCH' | 'NOT_RUN' | string
  readonly execution_mode: string
  readonly is_synthetic: boolean
  readonly checks_summary?: ManagedChecksSummary
  readonly checks: readonly ManagedCheckDTO[]
  readonly artifacts: readonly string[]
  readonly canonical_sha256?: string | null
  readonly result_sha?: string | null
  readonly evidence_items: readonly ManagedEvidenceItem[]
  readonly raw_evidence?: Record<string, unknown> | null
}

export type ManagedReviewPacketDTO = {
  readonly project_id: string
  readonly task_id: string
  readonly attempt_id?: string | null
  readonly packet_status: 'AVAILABLE' | 'NOT_FOUND' | 'NOT_RUN' | 'UNVERIFIED' | 'ERROR'
  readonly provenance: 'AUTHENTIC' | 'SYNTHETIC' | 'UNVERIFIED' | string
  readonly hash_status: 'VERIFIED' | 'MISMATCH' | 'NOT_RUN' | string
  readonly is_synthetic: boolean
  readonly execution_type: string
  readonly status: string
  readonly base_sha?: string | null
  readonly result_sha?: string | null
  readonly canonical_sha256?: string | null
  readonly started_at?: string | null
  readonly finished_at?: string | null
  readonly process_exit_code?: number | null
  readonly verdict?: string | null
  readonly checks_count: number
  readonly checks_summary?: ManagedChecksSummary
  readonly checks?: readonly ManagedCheckDTO[]
  readonly markdown_packet?: string | null
}

export type ManagedActivityItemDTO = {
  readonly id?: number
  readonly task_id: string
  readonly attempt_id?: string | null
  readonly from_state: string
  readonly to_state: string
  readonly reason: string
  readonly timestamp?: string | null
}

export type ManagedProjectsResult = {
  readonly ok: boolean
  readonly status: 'ONLINE' | 'OFFLINE' | 'ERROR'
  readonly error_code?: string
  readonly error_message?: string
  readonly projects: readonly ManagedProjectDTO[]
}

export type ManagedTasksResult = {
  readonly ok: boolean
  readonly status: 'ONLINE' | 'OFFLINE' | 'ERROR'
  readonly error_code?: string
  readonly error_message?: string
  readonly project_id?: string
  readonly tasks: readonly ManagedTaskDTO[]
}

export type ManagedExecutionResult = {
  readonly ok: boolean
  readonly status: 'ONLINE' | 'OFFLINE' | 'ERROR'
  readonly error_code?: string
  readonly error_message?: string
  readonly execution?: ManagedExecutionDTO | null
}

export type ManagedEvidenceResult = {
  readonly ok: boolean
  readonly status: 'ONLINE' | 'OFFLINE' | 'ERROR'
  readonly error_code?: string
  readonly error_message?: string
  readonly evidence?: ManagedEvidenceDTO | null
}

export type ManagedReviewPacketResult = {
  readonly ok: boolean
  readonly status: 'ONLINE' | 'OFFLINE' | 'ERROR'
  readonly error_code?: string
  readonly error_message?: string
  readonly review_packet?: ManagedReviewPacketDTO | null
}

export type ManagedActivityResult = {
  readonly ok: boolean
  readonly status: 'ONLINE' | 'OFFLINE' | 'ERROR'
  readonly error_code?: string
  readonly error_message?: string
  readonly project_id?: string
  readonly activities: readonly ManagedActivityItemDTO[]
}

export type ManagedProfileConfig = {
  profile: 'NORMAL' | 'STAGING_LOCAL'
  port: number
  token: string | null
  engineUrl: string
}
