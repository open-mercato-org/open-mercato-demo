import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'

export const TICKET_QUEUE_PRESETS = ['all', 'mine', 'manualReview', 'urgent'] as const

export type TicketQueuePreset = typeof TICKET_QUEUE_PRESETS[number]

export const QUEUE_PRESET_PARAM = 'preset'
export const QUEUE_FILTER_PARAM_PREFIX = 'filter.'
const ARRAY_SUFFIX = '[]'

export type TicketQueueUrlState = {
  preset: TicketQueuePreset
  filters: FilterValues
}

type SearchParamsReader = {
  forEach: (callback: (value: string, key: string) => void) => void
}

function isPreset(value: string | null): value is TicketQueuePreset {
  return value !== null && (TICKET_QUEUE_PRESETS as readonly string[]).includes(value)
}

function isOwnedParam(key: string): boolean {
  return key === QUEUE_PRESET_PARAM || key.startsWith(QUEUE_FILTER_PARAM_PREFIX)
}

export function parseQueueUrlState(params: SearchParamsReader | null | undefined): TicketQueueUrlState {
  let preset: TicketQueuePreset = 'all'
  const filters: FilterValues = {}
  const arrays = new Map<string, string[]>()
  params?.forEach((rawValue, key) => {
    const value = rawValue.trim()
    if (key === QUEUE_PRESET_PARAM) {
      if (isPreset(value)) preset = value
      return
    }
    if (!key.startsWith(QUEUE_FILTER_PARAM_PREFIX) || !value) return
    const name = key.slice(QUEUE_FILTER_PARAM_PREFIX.length)
    if (name.endsWith(ARRAY_SUFFIX)) {
      const id = name.slice(0, -ARRAY_SUFFIX.length)
      if (!id) return
      arrays.set(id, [...(arrays.get(id) ?? []), value])
      return
    }
    if (!name) return
    filters[name] = value === 'true' ? true : value
  })
  for (const [id, values] of arrays) filters[id] = values
  return { preset, filters }
}

function appendFilter(target: URLSearchParams, id: string, value: unknown): void {
  if (value === true) {
    target.append(`${QUEUE_FILTER_PARAM_PREFIX}${id}`, 'true')
    return
  }
  if (typeof value === 'string' && value.trim()) {
    target.append(`${QUEUE_FILTER_PARAM_PREFIX}${id}`, value.trim())
    return
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    target.append(`${QUEUE_FILTER_PARAM_PREFIX}${id}`, String(value))
    return
  }
  if (Array.isArray(value)) {
    const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    for (const entry of entries) target.append(`${QUEUE_FILTER_PARAM_PREFIX}${id}${ARRAY_SUFFIX}`, entry.trim())
  }
}

export function serializeQueueUrlState(state: TicketQueueUrlState, current?: SearchParamsReader | null): string {
  const next = new URLSearchParams()
  current?.forEach((value, key) => {
    if (!isOwnedParam(key)) next.append(key, value)
  })
  if (state.preset !== 'all') next.set(QUEUE_PRESET_PARAM, state.preset)
  for (const id of Object.keys(state.filters).sort()) appendFilter(next, id, state.filters[id])
  return next.toString()
}

export function buildTicketQueueHref(state: Partial<TicketQueueUrlState>, basePath = '/backend/tickets'): string {
  const query = serializeQueueUrlState({ preset: state.preset ?? 'all', filters: state.filters ?? {} })
  return query ? `${basePath}?${query}` : basePath
}
