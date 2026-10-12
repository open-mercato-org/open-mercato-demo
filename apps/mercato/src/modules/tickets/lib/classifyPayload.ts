import { resolveCategoryPathSnapshot, type KbCategory } from './kbTaxonomy'

export type ClassifyFormValues = {
  id: string
  updatedAt: string | null
  customerPersonId: string
  reservationId: string
  reservationNumberSnapshot: string
  categoryKey: string
  subcategoryKey: string
  topicKey: string
  categoryPathSnapshot: string
  priority: string
  priorityReason: string
  summary: string
}

function nullable(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function buildClassifyPayload(
  values: Partial<ClassifyFormValues>,
  taxonomy?: KbCategory[] | null,
): Record<string, unknown> {
  const categoryPathSnapshot = taxonomy
    ? resolveCategoryPathSnapshot(taxonomy, values, values.categoryPathSnapshot)
    : nullable(values.categoryPathSnapshot)
  const payload: Record<string, unknown> = {
    source: 'manual',
    customerPersonId: nullable(values.customerPersonId),
    reservationId: nullable(values.reservationId),
    reservationNumberSnapshot: nullable(values.reservationNumberSnapshot),
    categoryKey: nullable(values.categoryKey),
    subcategoryKey: nullable(values.subcategoryKey),
    topicKey: nullable(values.topicKey),
    categoryPathSnapshot,
    priorityReason: nullable(values.priorityReason),
    summary: nullable(values.summary),
  }
  const priority = nullable(values.priority)
  if (priority) payload.priority = priority
  return payload
}
