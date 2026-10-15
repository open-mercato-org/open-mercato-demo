import type { InjectionFilterWidget } from '@open-mercato/shared/modules/widgets/injection'
import { TRIAGE_STATUS_LABEL_KEYS, resolveTriageStatus, type TriageStatus } from '../../../components/triageTypes'
import { AWAITING_DECISION_FILTER_ID, AWAITING_DECISION_FILTER_VALUE } from '../../../data/constants'

const STATUSES: TriageStatus[] = ['analyzing', 'advising', 'awaiting_approval', 'applying', 'assisted', 'manual_review', 'failed']

function readTriage(row: unknown): { stage: string; aiMode: 'assisted' | 'manual_review' | null } | null {
  if (!row || typeof row !== 'object') return null
  const triage = (row as { _triage?: unknown })._triage
  if (!triage || typeof triage !== 'object') return null
  const stage = (triage as { stage?: unknown }).stage
  const aiMode = (triage as { aiMode?: unknown }).aiMode
  if (typeof stage !== 'string') return null
  return { stage, aiMode: aiMode === 'assisted' || aiMode === 'manual_review' ? aiMode : null }
}

export function matchesTriageStatus(row: unknown, value: unknown): boolean {
  if (typeof value !== 'string' || !value) return true
  return resolveTriageStatus(readTriage(row)) === value
}

const widget: InjectionFilterWidget = {
  metadata: {
    id: 'triage_agents.injection.triage-queue-filter',
    title: 'AI status filter',
    description: 'Filters the ticket queue by AI triage status and by proposals awaiting a decision.',
    features: ['triage_agents.view'],
    priority: 50,
    enabled: true,
  },
  filters: [
    {
      id: 'triageAiStatus',
      label: 'triage_agents.queue.filter',
      type: 'select',
      strategy: 'client',
      options: STATUSES.map((status) => ({ value: status, label: TRIAGE_STATUS_LABEL_KEYS[status].key })),
      filterFn: matchesTriageStatus,
    },
    {
      id: AWAITING_DECISION_FILTER_ID,
      label: 'triage_agents.queue.decisionFilter.label',
      type: 'select',
      strategy: 'server',
      options: [{ value: AWAITING_DECISION_FILTER_VALUE, label: 'triage_agents.queue.decisionFilter.awaiting' }],
    },
  ],
}

export default widget
