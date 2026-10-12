import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'

export type TriageUncertaintyView = {
  code: string
  message: string
  blocking: boolean
  source: string
}

export type TriageCandidateView = {
  reservationId: string | null
  bookingNumber: string | null
  label: string | null
  daysToDeparture: number | null
}

export type TriageIdentificationView = {
  customer?: { personId: string | null; match: string }
  reservation?: {
    reservationId: string | null
    bookingNumber: string | null
    match: string
    departureDate: string | null
    daysToDeparture: number | null
    candidates: TriageCandidateView[]
  }
  confidence?: number | null
}

export type TriageClassificationView = {
  categoryKey?: string | null
  topicKey?: string | null
  topicVersion?: number | null
  categoryPath?: string | null
  intent?: string | null
  automationLevel?: string | null
  confidence?: number | null
}

export type TriageView = {
  ticketId: string
  aiMode: 'assisted' | 'manual_review' | null
  stage: string
  reason: string | null
  reasonCode: string | null
  route: string | null
  priority: string | null
  priorityReason: string | null
  recommendedActionLabel: string | null
  draftState: string
  confidence: number | null
  proposalId: string | null
  disposition: string | null
  executionId: string | null
  workflowInstanceId: string | null
  attempt: number
  groundingState: string
  groundingIssues: string[]
  identification: TriageIdentificationView | null
  classification: TriageClassificationView | null
  uncertainty: TriageUncertaintyView[]
  updatedAt: string
}

export type TriageStatus = 'analyzing' | 'awaiting_approval' | 'applying' | 'assisted' | 'manual_review' | 'failed'

const ANALYZING_STAGES = new Set(['queued', 'identifying', 'classifying'])

export function resolveTriageStatus(triage: Pick<TriageView, 'stage' | 'aiMode'> | null | undefined): TriageStatus | null {
  if (!triage) return null
  if (triage.stage === 'failed') return 'failed'
  if (triage.stage === 'awaiting_approval') return 'awaiting_approval'
  if (triage.stage === 'applying') return 'applying'
  if (ANALYZING_STAGES.has(triage.stage)) return 'analyzing'
  return triage.aiMode === 'assisted' ? 'assisted' : 'manual_review'
}

export const TRIAGE_STATUS_VARIANTS: Record<TriageStatus, StatusBadgeVariant> = {
  analyzing: 'neutral',
  awaiting_approval: 'info',
  applying: 'info',
  assisted: 'info',
  manual_review: 'warning',
  failed: 'error',
}

export const TRIAGE_STATUS_LABEL_KEYS: Record<TriageStatus, { key: string; fallback: string }> = {
  analyzing: { key: 'triage_agents.status.analyzing', fallback: 'Analyzing…' },
  awaiting_approval: { key: 'triage_agents.status.awaitingApproval', fallback: 'Awaiting approval' },
  applying: { key: 'triage_agents.status.applying', fallback: 'Applying' },
  assisted: { key: 'triage_agents.status.assisted', fallback: 'Assisted' },
  manual_review: { key: 'triage_agents.status.manualReview', fallback: 'Manual review' },
  failed: { key: 'triage_agents.status.failed', fallback: 'AI failed' },
}

export function isTriageView(value: unknown): value is TriageView {
  return Boolean(value) && typeof value === 'object' && typeof (value as { stage?: unknown }).stage === 'string'
}
