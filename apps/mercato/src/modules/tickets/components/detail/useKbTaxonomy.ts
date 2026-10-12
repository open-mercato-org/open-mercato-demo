"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { KB_TAXONOMY_PATH, parseKbTaxonomy, type KbCategory } from '../../lib/kbTaxonomy'

export type KbTaxonomyState =
  | { status: 'loading' }
  | { status: 'ready'; taxonomy: KbCategory[] }
  | { status: 'unavailable' }

export function useKbTaxonomy(enabled: boolean): KbTaxonomyState {
  const [state, setState] = React.useState<KbTaxonomyState>({ status: 'loading' })

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setState({ status: 'loading' })
    apiCall<unknown>(KB_TAXONOMY_PATH, { headers: { 'x-om-forbidden-redirect': '0' } })
      .then((response) => {
        if (cancelled) return
        const taxonomy = response.ok ? parseKbTaxonomy(response.result) : null
        setState(taxonomy && taxonomy.length ? { status: 'ready', taxonomy } : { status: 'unavailable' })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unavailable' })
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return state
}
