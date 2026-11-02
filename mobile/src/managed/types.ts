export type ManagedCertificationStatus = 'CERTIFIED' | 'UNCERTIFIED' | 'REJECTED'

export type ManagedCheckDTO = {
  readonly name: string
  readonly status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN' | 'SKIPPED' | 'ERROR' | string
  readonly exit_code?: number | null
}

export type ManagedChecksSummaryDTO = {
  readonly passed: number
  readonly failed: number
  readonly total: number
}

export type ManagedMemoryTelemetryDTO = {
  readonly status: 'MEASURED' | 'NOT_MEASURED' | string
  readonly peak_rss_bytes?: number | null
}

export type ManagedProjectDTO = {
  readonly id: string
  readonly name: string
  readonly description?: string | null
  readonly status: string
  readonly mode: string
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

export type ManagedEvidenceDTO = {
  readonly project_id: string
  readonly task_id: string
  readonly attempt_id?: string | null
  readonly evidence_status: string
  readonly provenance: 'AUTHENTIC' | 'SYNTHETIC' | 'UNVERIFIED' | string
  readonly provenance_verified: boolean
  readonly commit_exists: boolean
  readonly hash_status: 'VERIFIED' | 'MISMATCH' | 'NOT_RUN' | string
  readonly hash_verified: boolean
  readonly certification_status: ManagedCertificationStatus
  readonly execution_mode: string
  readonly is_synthetic: boolean
  readonly checks_summary: ManagedChecksSummaryDTO
  readonly checks: readonly ManagedCheckDTO[]
  readonly artifacts: readonly string[]
  readonly canonical_sha256?: string | null
  readonly result_sha?: string | null
  readonly memory_telemetry: ManagedMemoryTelemetryDTO
  readonly evidence_items?: readonly Record<string, unknown>[]
}

export type ManagedReviewPacketDTO = {
  readonly project_id: string
  readonly task_id: string
  readonly attempt_id?: string | null
  readonly packet_status: string
  readonly provenance: 'AUTHENTIC' | 'SYNTHETIC' | 'UNVERIFIED' | string
  readonly provenance_verified: boolean
  readonly commit_exists: boolean
  readonly hash_status: 'VERIFIED' | 'MISMATCH' | 'NOT_RUN' | string
  readonly hash_verified: boolean
  readonly certification_status: ManagedCertificationStatus
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
  readonly checks_summary: ManagedChecksSummaryDTO
  readonly checks: readonly ManagedCheckDTO[]
  readonly memory_telemetry: ManagedMemoryTelemetryDTO
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

export type MobileDeviceRole = 'MOBILE_READONLY'

export type MobileDeviceCredential = {
  readonly deviceId: string
  readonly deviceName: string
  readonly deviceToken: string
  readonly hostId: string
  readonly hostAddress?: string
  readonly issuedAt: number
  readonly expiresAt: number
  readonly role: MobileDeviceRole
  readonly revoked: boolean
  readonly nonce: string
}

export type PairingOffer = {
  readonly offerId: string
  readonly hostId: string
  readonly hostName: string
  readonly fingerprint: string
  readonly timestamp: number
  readonly expiresAt: number
  readonly nonce: string
  readonly hostPublicKey?: string
  readonly hostSignature?: string
}

export interface ManagedDataProvider {
  listProjects(): Promise<readonly ManagedProjectDTO[]>
  listTasks(projectId: string): Promise<readonly ManagedTaskDTO[]>
  getEvidence(projectId: string, taskId: string): Promise<ManagedEvidenceDTO | null>
  getConnectionStatus?(): MobileConnectionStatus
}

export type PairingHandshake = {
  readonly deviceId: string
  readonly deviceName: string
  readonly offerId: string
  readonly clientNonce: string
  readonly timestamp: number
}

export type MobileConnectionStatus =
  | 'UNPAIRED'
  | 'CONNECTING'
  | 'ONLINE'
  | 'OFFLINE'
  | 'AUTH_REQUIRED'
  | 'UNVERIFIED'
  | 'EXPIRED'
  | 'REVOKED'
