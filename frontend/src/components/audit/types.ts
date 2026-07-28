/**
 * Shared types for the Audit Log screen (`GET /audit` list items and the
 * `GET /audit/{query_run_id}` full detail view). Mirrors `spec/api.md`.
 */

export type AuditItemType = 'login_success' | 'login_failure' | 'logout' | 'upload' | 'query'

export type AuditItem = {
  type: AuditItemType
  user: string
  timestamp: string
  detail: string
  dataset?: string
  status?: string
  query_run_id?: string
}

export type AuditListResponse = {
  items: AuditItem[]
  page: number
  page_size: number
  total: number
}

export type QueryAttempt = {
  attempt_number: number
  generated_code: string
  execution_result: unknown
  execution_error: string | null
  duration_ms: number
}

export type AuditQueryDetail = {
  query_run_id: string
  status: string
  question: string
  final_answer: string | null
  key_numbers: Record<string, unknown> | null
  assumptions: string[]
  complexity: string | null
  plan: unknown
  attempts: QueryAttempt[]
  followups: string[]
  prompt_tokens: number | null
  completion_tokens: number | null
  estimated_cost_usd: number | null
  started_at: string
  completed_at: string | null
  user: string
  dataset: string
}

/** Human-readable label for an audit item's machine `type`. */
export function auditTypeLabel(type: AuditItemType): string {
  switch (type) {
    case 'login_success':
      return 'Login'
    case 'login_failure':
      return 'Login failed'
    case 'logout':
      return 'Logout'
    case 'upload':
      return 'Upload'
    case 'query':
      return 'Query'
    default:
      return type
  }
}
