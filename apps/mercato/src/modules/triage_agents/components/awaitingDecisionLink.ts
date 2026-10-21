import { AWAITING_DECISION_FILTER_ID, AWAITING_DECISION_FILTER_VALUE } from '../data/constants'

export const AWAITING_DECISION_URL_PARAM = `filter.${AWAITING_DECISION_FILTER_ID}`

type SearchParamsReader = {
  get: (key: string) => string | null
  forEach: (callback: (value: string, key: string) => void) => void
}

export function isAwaitingDecisionActive(params: SearchParamsReader | null | undefined): boolean {
  return params?.get(AWAITING_DECISION_URL_PARAM) === AWAITING_DECISION_FILTER_VALUE
}

export function toggleAwaitingDecisionHref(pathname: string, params: SearchParamsReader | null | undefined): string {
  const active = isAwaitingDecisionActive(params)
  const next = new URLSearchParams()
  params?.forEach((value, key) => {
    if (key !== AWAITING_DECISION_URL_PARAM) next.append(key, value)
  })
  if (!active) next.set(AWAITING_DECISION_URL_PARAM, AWAITING_DECISION_FILTER_VALUE)
  const query = next.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function formatAwaitingDecisionCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}
