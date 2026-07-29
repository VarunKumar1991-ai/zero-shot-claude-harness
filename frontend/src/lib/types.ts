/** Shared response shapes mirrored from spec/api.md — kept in one place so
 * every component/page agrees on the contract. */

export type DatasetColumn = {
  name: string
  inferredType: string
}

export type QualityFlag = {
  type: string
  count: number
  sampleRowRefs: number[]
}

export type DatasetProfile = {
  id: string
  name: string
  rowCount: number
  columns: DatasetColumn[]
  dateRangeMin: string | null
  dateRangeMax: string | null
  qualityFlags: QualityFlag[]
}

export type DatasetSummary = {
  id: string
  name: string
  rowCount: number
  createdAt: string
}

export type KeyNumber = {
  label: string
  value: number | string
}

export type QueryAttempt = {
  code: string
  executionResult: { result: unknown; error: string | null }
  inspection: string
}

export type TokenUsage = {
  promptTokens: number
  completionTokens: number
}

export type QueryStatus = 'completed' | 'failed' | 'needs_clarification'

export type QueryResult = {
  id: string
  status: QueryStatus
  answer: string | null
  keyNumbers: KeyNumber[]
  assumptions: string[]
  clarifyingQuestion: string | null
  generatedCode: string | null
  attempts: QueryAttempt[]
  chartSpec: unknown
  followups: string[]
  tokenUsage: TokenUsage
  createdAt: string
  completedAt: string | null
}

export type QueryHistoryItem = {
  id: string
  question: string
  answer: string | null
  status: QueryStatus
  createdAt: string
}
