export const TRIAGE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

export type TriagePriority = (typeof TRIAGE_PRIORITIES)[number]

export type UrgencySignal = 'none' | 'raise_one'

export const PRIORITY_RANK: Record<TriagePriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
  urgent: 4,
}

export const DEPARTURE_PRIORITY_THRESHOLDS: ReadonlyArray<{ maxDays: number; priority: TriagePriority }> = [
  { maxDays: 1, priority: 'urgent' },
  { maxDays: 3, priority: 'high' },
  { maxDays: 14, priority: 'normal' },
]

export type PriorityReasonKey =
  | 'no_departure_date'
  | 'departure_passed'
  | 'departure_today'
  | 'departure_tomorrow'
  | 'departure_in_days'

export type ComputePriorityInput = {
  daysToDeparture: number | null | undefined
  priorityFloor?: string | null
  urgencySignal?: string | null
}

export type ComputePriorityResult = {
  priority: TriagePriority
  priorityReason: string
  reasonKey: PriorityReasonKey
  days: number | null
  floorApplied: boolean
  urgencyRaised: boolean
}

export function isTriagePriority(value: unknown): value is TriagePriority {
  return typeof value === 'string' && (TRIAGE_PRIORITIES as readonly string[]).includes(value)
}

function priorityFromRank(rank: number): TriagePriority {
  const clamped = Math.min(Math.max(Math.round(rank), PRIORITY_RANK.low), PRIORITY_RANK.urgent)
  return TRIAGE_PRIORITIES[clamped - 1]
}

export function normalizeDays(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Math.trunc(Number(value))
  return null
}

export function basePriorityForDays(days: number | null): { priority: TriagePriority; reasonKey: PriorityReasonKey } {
  if (days === null) return { priority: 'low', reasonKey: 'no_departure_date' }
  if (days < 0) return { priority: 'low', reasonKey: 'departure_passed' }
  const reasonKey: PriorityReasonKey = days === 0 ? 'departure_today' : days === 1 ? 'departure_tomorrow' : 'departure_in_days'
  const match = DEPARTURE_PRIORITY_THRESHOLDS.find((threshold) => days <= threshold.maxDays)
  return { priority: match?.priority ?? 'low', reasonKey }
}

const REASON_DETAIL: Record<PriorityReasonKey, (days: number | null) => string> = {
  no_departure_date: () => 'no departure date',
  departure_passed: () => 'departure date has passed',
  departure_today: () => 'departure today',
  departure_tomorrow: () => 'departure tomorrow',
  departure_in_days: (days) => `departure in ${days ?? 0} days`,
}

export function formatPriorityReason(
  priority: TriagePriority,
  reasonKey: PriorityReasonKey,
  days: number | null,
  flags: { floorApplied: boolean; urgencyRaised: boolean },
): string {
  const parts = [`${priority} – ${REASON_DETAIL[reasonKey](days)}`]
  if (flags.floorApplied) parts.push('topic minimum')
  if (flags.urgencyRaised) parts.push('urgency stated in message')
  return parts.join(' + ')
}

export function computePriority(input: ComputePriorityInput): ComputePriorityResult {
  const days = normalizeDays(input.daysToDeparture)
  const base = basePriorityForDays(days)
  let rank = PRIORITY_RANK[base.priority]
  let floorApplied = false
  if (isTriagePriority(input.priorityFloor) && PRIORITY_RANK[input.priorityFloor] > rank) {
    rank = PRIORITY_RANK[input.priorityFloor]
    floorApplied = true
  }
  let urgencyRaised = false
  if (input.urgencySignal === 'raise_one' && rank < PRIORITY_RANK.urgent) {
    rank += 1
    urgencyRaised = true
  }
  const priority = priorityFromRank(rank)
  return {
    priority,
    priorityReason: formatPriorityReason(priority, base.reasonKey, days, { floorApplied, urgencyRaised }),
    reasonKey: base.reasonKey,
    days,
    floorApplied,
    urgencyRaised,
  }
}
