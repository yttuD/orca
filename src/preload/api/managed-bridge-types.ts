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
  status: () => Promise<{ status: string; ok: boolean; profile?: string }>
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
      readonly execution_mode: string
      readonly is_synthetic: boolean
      readonly checks: readonly Record<string, unknown>[]
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
      readonly attempt_id?: string | null
      readonly packet_status: 'AVAILABLE' | 'NOT_FOUND' | 'NOT_RUN' | 'UNVERIFIED' | 'ERROR'
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
}
