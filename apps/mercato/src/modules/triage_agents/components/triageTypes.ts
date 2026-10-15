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
  source?: 'ai' | 'manual' | null
}

export const TRIAGE_DECISION_CARD_ANCHOR = 'triage-decision-card'

export const TICKET_DELETED_REASON_CODE = 'ticket_deleted'

export type TriageAttemptView = {
  attempt: number
  executionId: string | null
  stage: string
  aiMode: string | null
  reasonCode: string | null
  disposition: string | null
  recordedAt: string
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
  attempts?: TriageAttemptView[]
  groundingState: string
  groundingIssues: string[]
  identification: TriageIdentificationView | null
  classification: TriageClassificationView | null
  uncertainty: TriageUncertaintyView[]
  updatedAt: string
}

export type TriageStatus = 'analyzing' | 'advising' | 'awaiting_approval' | 'applying' | 'assisted' | 'manual_review' | 'failed' | 'cancelled'

const ANALYZING_STAGES = new Set(['queued', 'identifying', 'classifying'])

export function resolveTriageStatus(triage: Pick<TriageView, 'stage' | 'aiMode'> | null | undefined): TriageStatus | null {
  if (!triage) return null
  if (triage.stage === 'failed') return 'failed'
  if (triage.stage === 'cancelled') return 'cancelled'
  if (triage.stage === 'advising') return 'advising'
  if (triage.stage === 'awaiting_approval') return 'awaiting_approval'
  if (triage.stage === 'applying') return 'applying'
  if (ANALYZING_STAGES.has(triage.stage)) return 'analyzing'
  return triage.aiMode === 'assisted' ? 'assisted' : 'manual_review'
}

export const TRIAGE_STATUS_VARIANTS: Record<TriageStatus, StatusBadgeVariant> = {
  analyzing: 'neutral',
  advising: 'neutral',
  awaiting_approval: 'info',
  applying: 'info',
  assisted: 'info',
  manual_review: 'warning',
  failed: 'error',
  cancelled: 'neutral',
}

export const TRIAGE_STATUS_LABEL_KEYS: Record<TriageStatus, { key: string; fallback: string }> = {
  analyzing: { key: 'triage_agents.status.analyzing', fallback: 'Analyzing…' },
  advising: { key: 'triage_agents.status.advising', fallback: 'Preparing proposal…' },
  awaiting_approval: { key: 'triage_agents.status.awaitingApproval', fallback: 'Awaiting approval' },
  applying: { key: 'triage_agents.status.applying', fallback: 'Applying' },
  assisted: { key: 'triage_agents.status.assisted', fallback: 'Assisted' },
  manual_review: { key: 'triage_agents.status.manualReview', fallback: 'Manual review' },
  failed: { key: 'triage_agents.status.failed', fallback: 'AI failed' },
  cancelled: { key: 'triage_agents.status.cancelled', fallback: 'Cancelled' },
}

export function isTriageView(value: unknown): value is TriageView {
  return Boolean(value) && typeof value === 'object' && typeof (value as { stage?: unknown }).stage === 'string'
}

export function pendingProposalId(triage: Pick<TriageView, 'stage' | 'proposalId' | 'disposition'> | null | undefined): string | null {
  if (!triage || triage.stage !== 'awaiting_approval' || triage.disposition) return null
  return triage.proposalId ?? null
}

/** Execution ids of every attempt of the ticket, oldest first, the current one last. */
export function attemptExecutionIds(triage: Pick<TriageView, 'executionId' | 'attempts'> | null | undefined): string[] {
  if (!triage) return []
  const ordered = [...(triage.attempts ?? [])].sort((left, right) => left.attempt - right.attempt)
  const ids: string[] = []
  for (const entry of ordered) {
    if (entry.executionId && !ids.includes(entry.executionId)) ids.push(entry.executionId)
  }
  if (triage.executionId) {
    const index = ids.indexOf(triage.executionId)
    if (index >= 0) ids.splice(index, 1)
    ids.push(triage.executionId)
  }
  return ids
}

/** The execution the flow tab opens: the current attempt, else the latest recorded one. */
export function currentExecutionId(triage: Pick<TriageView, 'executionId' | 'attempts'> | null | undefined): string | null {
  const ids = attemptExecutionIds(triage)
  return triage?.executionId ?? ids[ids.length - 1] ?? null
}
