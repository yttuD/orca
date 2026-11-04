export type ManagedQaLifecycleDTO = {
  readonly phase: 'DISABLED' | 'STOPPED' | 'STARTING' | 'ONLINE' | 'DEGRADED' |
    'RECOVERING' | 'ERROR' | 'STOPPING'
  readonly owner: 'NONE' | 'THIS_ELECTRON'
  readonly port: number | null
  readonly restarts: number
  readonly error_code?: string
}

export type ManagedBridgeApi = {
  listProjects: () => Promise<{
    ok: boolean
    status: 'ONLINE' | 'OFFLINE' | 'ERROR'
    error_code?: string
    error_message?: string
    projects: readonly {
      readonly id: string
      readonly name: string
      readonly description?: string | null
      readonly status: string
      readonly mode: string
      readonly created_at?: string | null
      readonly updated_at?: string | null
    }[]
  }>
  status: () => Promise<{
    status: string
    ok: boolean
    profile?: string
    qa_lifecycle?: ManagedQaLifecycleDTO
  }>
  qaEngineLifecycle: () => Promise<ManagedQaLifecycleDTO>
  qaStopEngine: () => Promise<{
    ok: boolean
    error_code?: string
    lifecycle?: ManagedQaLifecycleDTO
  }>
  edgeHealth: () => Promise<{
    status: 'ONLINE' | 'OFFLINE' | 'NOT_CONFIGURED' | 'LEGACY' | 'ERROR'
    port: number
    latest_seq?: number
    error_code?: string
  }>
  listTasks: (projectId?: string) => Promise<{
    ok: boolean
    status: 'ONLINE' | 'OFFLINE' | 'ERROR'
    error_code?: string
    error_message?: string
    project_id?: string
    tasks: readonly {
      readonly id: string
      readonly project_id: string
      readonly title: string
      readonly status: string
      readonly executor: string
      readonly created_at?: string | null
      readonly updated_at?: string | null
    }[]
  }>
  getExecution: (
    projectId: string,
    taskId: string
  ) => Promise<{
    ok: boolean
    status: 'ONLINE' | 'OFFLINE' | 'ERROR'
    error_code?: string
    error_message?: string
    execution?: {
      readonly task_id: string
      readonly project_id: string
      readonly status: string
      readonly executor: string
      readonly attempt_id?: string | null
      readonly lease_owner: string
      readonly lease_generation: number
      readonly last_activity?: string | null
      readonly verdict?: string | null
    } | null
  }>
  getEvidence: (
    projectId: string,
    taskId: string,
    attemptId?: string,
    evidenceKey?: string
  ) => Promise<{
    ok: boolean
    status: 'ONLINE' | 'OFFLINE' | 'ERROR'
    error_code?: string
    error_message?: string
    evidence?: {
      readonly project_id: string
      readonly task_id: string
      readonly attempt_id?: string | null
      readonly evidence_status: 'AVAILABLE' | 'NOT_FOUND' | 'NOT_RUN' | 'UNVERIFIED' | 'ERROR'
      readonly provenance: 'AUTHENTIC' | 'SYNTHETIC' | 'UNVERIFIED' | string
      readonly hash_status: 'VERIFIED' | 'MISMATCH' | 'NOT_RUN' | string
      readonly execution_mode: string
      readonly is_synthetic: boolean
      readonly checks_summary?: {
        readonly passed: number
        readonly failed: number
        readonly total: number
      }
      readonly checks: readonly {
        readonly name: string
        readonly status: string
        readonly exit_code?: number | null
      }[]
      readonly artifacts: readonly string[]
      readonly canonical_sha256?: string | null
      readonly result_sha?: string | null
    } | null
  }>
  presentReviewPacket: (
    projectId: string,
    taskId: string,
    attemptId?: string
  ) => Promise<{
    ok: boolean
    status: 'ONLINE' | 'OFFLINE' | 'ERROR'
    error_code?: string
    error_message?: string
    review_packet?: {
      readonly project_id: string
      readonly task_id: string
  readonly repo_id?: string
  readonly task_sha256?: string | null
  readonly context_checkpoint_sha256?: string | null
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
      readonly checks_summary?: {
        readonly passed: number
        readonly failed: number
        readonly total: number
      }
      readonly checks?: readonly {
        readonly name: string
        readonly status: string
        readonly exit_code?: number | null
      }[]
      readonly markdown_packet?: string | null
    } | null
  }>
  listActivity: (
    projectId: string,
    taskId?: string,
    limit?: number,
    beforeId?: number
  ) => Promise<{
    ok: boolean
    status: 'ONLINE' | 'OFFLINE' | 'ERROR'
    error_code?: string
    error_message?: string
    project_id?: string
    activities: readonly {
      readonly id?: number
      readonly task_id: string
      readonly attempt_id?: string | null
      readonly from_state: string
      readonly to_state: string
      readonly reason: string
      readonly timestamp?: string | null
    }[]
  }>
  listDrafts: (projectId: string) => Promise<{
    ok: boolean
    status: 'ONLINE' | 'OFFLINE' | 'ERROR'
    error_code?: string
    error_message?: string
    drafts: readonly {
      readonly draft_id: string
      readonly project_id: string
      readonly title: string
      readonly description: string
      readonly executor: string
      readonly model?: string | null
      readonly base_ref: string
      readonly base_sha?: string | null
      readonly state: string
      readonly envelope?: Record<string, unknown> | null
  readonly envelope_sha256?: string | null
      readonly task_id?: string | null
      readonly allowed_paths?: readonly string[]
      readonly requested_checks?: readonly string[]
      readonly max_runtime_seconds?: number
      readonly created_at?: string | null
      readonly updated_at?: string | null
    }[]
  }>
  createDraft: (
    projectId: string,
    draft: Record<string, unknown>
  ) => Promise<{
    ok: boolean
    status: string
    error_code?: string
    error_message?: string
    data?: Record<string, unknown>
  }>
  prepareDraft: (
    projectId: string,
    draftId: string
  ) => Promise<{
    ok: boolean
    status: string
    error_code?: string
    error_message?: string
    data?: Record<string, unknown>
  }>
  approveDraft: (
    projectId: string,
    draftId: string,
    operatorNotes?: string
  ) => Promise<{
    ok: boolean
    status: string
    error_code?: string
    error_message?: string
    data?: Record<string, unknown>
  }>
  authorizeInference: (
    projectId: string,
    taskId: string,
    provider: string,
    attemptId?: string
  ) => Promise<{
    ok: boolean
    status: string
    error_code?: string
    error_message?: string
    data?: Record<string, unknown>
  }>
  dispatchTask: (
    projectId: string,
    taskId: string,
    attemptId?: string
  ) => Promise<{
    ok: boolean
    status: string
    error_code?: string
    error_message?: string
    data?: Record<string, unknown>
  }>
  submitVerdict: (
    projectId: string,
    verdict: Record<string, unknown>,
    authorizationMode?: string
  ) => Promise<{
    ok: boolean
    status: string
    error_code?: string
    error_message?: string
    data?: Record<string, unknown>
  }>
  exportReviewPacket: (
    projectId: string,
    taskId: string,
    markdown: string,
    suggestedFilename?: string
  ) => Promise<{ ok: boolean; path?: string; error?: string }>
}
