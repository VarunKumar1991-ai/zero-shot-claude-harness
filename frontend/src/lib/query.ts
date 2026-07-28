/**
 * Types + fetch helpers for the Ask/chat screen (`/datasets/[id]/ask`).
 * Mirrors `spec/api.md`'s query/conversation endpoints exactly.
 */

import { apiGet, apiPost } from './api'

export type QueryAttempt = {
  attempt_number: number
  generated_code: string
  execution_result: unknown
  execution_error: string | null
  duration_ms: number
}

export type QueryStatus = 'pending' | 'needs_clarification' | 'completed' | 'failed'

export type QueryRunPending = {
  query_run_id: string
  status: 'pending'
  current_node: string
}

export type QueryRunCompleted = {
  query_run_id: string
  status: 'completed'
  question: string
  final_answer: string
  key_numbers: Record<string, unknown> | null
  assumptions: string[]
  complexity: string
  plan: string[] | null
  attempts: QueryAttempt[]
  followups: string[]
  prompt_tokens: number
  completion_tokens: number
  estimated_cost_usd: number
  started_at: string
  completed_at: string
}

export type QueryRunNeedsClarification = {
  query_run_id: string
  status: 'needs_clarification'
  clarifying_question: string
}

export type QueryRunFailed = {
  query_run_id: string
  status: 'failed'
  error: string
}

export type QueryRunResponse =
  | QueryRunPending
  | QueryRunCompleted
  | QueryRunNeedsClarification
  | QueryRunFailed

export type ConversationTurn = {
  query_run_id: string
  question: string
  final_answer: string | null
  status: string
  started_at: string
}

export type DatasetSummary = {
  dataset_id: string
  name: string
  status: string
}

/** POST /datasets/{id}/query — starts the agent graph, returns the pending query_run_id. */
export function submitQuery(
  datasetId: string,
  question: string
): Promise<{ query_run_id: string; status: 'pending' }> {
  return apiPost<{ query_run_id: string; status: 'pending' }>(
    `/datasets/${datasetId}/query`,
    { question }
  )
}

/** GET /datasets/{id}/queries/{query_run_id} — poll for progress/result. */
export function getQueryRun(datasetId: string, queryRunId: string): Promise<QueryRunResponse> {
  return apiGet<QueryRunResponse>(`/datasets/${datasetId}/queries/${queryRunId}`)
}

/** GET /datasets/{id}/conversation — last N turns for this dataset. */
export function getConversation(datasetId: string): Promise<ConversationTurn[]> {
  return apiGet<ConversationTurn[]>(`/datasets/${datasetId}/conversation`)
}

/** GET /datasets/{id} — used here only for the page header (dataset name). */
export function getDataset(datasetId: string): Promise<DatasetSummary> {
  return apiGet<DatasetSummary>(`/datasets/${datasetId}`)
}
