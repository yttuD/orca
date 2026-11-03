export type CheckDTO = {
  readonly name: string
  readonly status: string
  readonly exit_code?: number | null
}

export type ChecksSummaryDTO = {
  readonly passed: number
  readonly failed: number
  readonly total: number
}

export type EvidenceDTO = {
  readonly evidence_status: string
  readonly provenance: string
  readonly hash_status: string
  readonly execution_mode: string
  readonly is_synthetic: boolean
  readonly checks_summary?: ChecksSummaryDTO
  readonly checks: readonly CheckDTO[]
  readonly artifacts: readonly string[]
  readonly canonical_sha256?: string | null
  readonly result_sha?: string | null
}

export type ReviewPacketDTO = {
  readonly project_id?: string
  readonly task_id?: string
  readonly repo_id?: string
  readonly task_sha256?: string | null
  readonly context_checkpoint_sha256?: string | null
  readonly attempt_id?: string | null
  readonly packet_status: string
  readonly provenance: string
  readonly hash_status: string
  readonly certification_status?: string
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
  readonly checks_summary?: ChecksSummaryDTO
  readonly checks?: readonly CheckDTO[]
  readonly markdown_packet?: string | null
}

export type ActivityItemDTO = {
  readonly id?: number
  readonly from_state: string
  readonly to_state: string
  readonly reason: string
  readonly timestamp?: string | null
}

export async function computeSha256Hex(content: string): Promise<string> {
  const enc = new TextEncoder()
  const bytes = enc.encode(content)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function exportMarkdownFile(content: string, filename: string): boolean {
  try {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}
