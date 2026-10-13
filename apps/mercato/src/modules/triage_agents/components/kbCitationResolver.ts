import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  registerCitationResolver,
  type CitationRef,
  type CitationResolver,
  type ResolvedCitation,
} from '@open-mercato/enterprise/modules/agent_orchestrator/components/citationResolvers'

export const KB_CITATION_KIND = 'kb'

export type KbCitationTarget = { key: string; version: number | 'latest' }

type NamedRef = { name?: unknown } | null | undefined

export type KbVersionResponse = {
  key?: unknown
  version?: unknown
  articleId?: unknown
  snapshot?: {
    title?: unknown
    category?: NamedRef
    subcategory?: NamedRef
    procedureSteps?: unknown
  } | null
}

export type KbVersionFetcher = (target: KbCitationTarget) => Promise<KbVersionResponse | null>

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** `payments.refunds.overpayment_refund@3#S4` → `{ key, version: 3 }`; no version → `latest`. */
export function parseKbCitationRef(ref: string): KbCitationTarget | null {
  const base = ref.split('#')[0]?.trim() ?? ''
  if (!base) return null
  const at = base.lastIndexOf('@')
  if (at < 0) return { key: base, version: 'latest' }
  const key = base.slice(0, at).trim()
  const rawVersion = base.slice(at + 1).trim()
  if (!key) return null
  if (!rawVersion || rawVersion === 'latest') return { key, version: 'latest' }
  const version = Number(rawVersion)
  if (!Number.isInteger(version) || version < 1) return null
  return { key, version }
}

export function kbArticleHref(articleId: string): string {
  return `/backend/knowledge/articles/${encodeURIComponent(articleId)}`
}

/** Maps the KB version endpoint response to the citations panel view (title path + version, link, step texts). */
export function mapKbVersionToCitation(response: KbVersionResponse | null, citation: CitationRef): ResolvedCitation | null {
  if (!response || !response.snapshot) return null
  const snapshot = response.snapshot
  const title = readText(snapshot.title)
  if (!title) return null
  const path = [readText(snapshot.category?.name), readText(snapshot.subcategory?.name), title].filter(Boolean).join(' › ')
  const version = typeof response.version === 'number' ? response.version : null
  const articleId = readText(response.articleId)
  const steps = (Array.isArray(snapshot.procedureSteps) ? snapshot.procedureSteps : [])
    .map((step) => {
      const record = step && typeof step === 'object' ? (step as { id?: unknown; text?: unknown }) : null
      const id = readText(record?.id)
      const text = readText(record?.text)
      return id && text ? { id, text } : null
    })
    .filter((step): step is { id: string; text: string } => step !== null)
  return {
    title: version !== null ? `${path} (v${version})` : path,
    href: articleId ? kbArticleHref(articleId) : citation.href ?? null,
    steps,
  }
}

export const fetchKbVersion: KbVersionFetcher = async ({ key, version }) => {
  const call = await apiCall<KbVersionResponse>(
    `/api/knowledge_articles/articles/${encodeURIComponent(key)}/versions/${encodeURIComponent(String(version))}`,
    undefined,
    { fallback: null },
  )
  return call.ok ? call.result ?? null : null
}

/** A `kb` resolver; immutable `key@version` snapshots are cached, `latest` is always re-read. */
export function createKbCitationResolver(fetcher: KbVersionFetcher = fetchKbVersion): CitationResolver {
  const cache = new Map<string, Promise<KbVersionResponse | null>>()
  return async (citation) => {
    const target = parseKbCitationRef(citation.ref)
    if (!target) return null
    const cacheKey = `${target.key}@${target.version}`
    let pending = target.version === 'latest' ? undefined : cache.get(cacheKey)
    if (!pending) {
      pending = fetcher(target)
      if (target.version !== 'latest') {
        cache.set(cacheKey, pending)
        pending.then((value) => {
          if (!value) cache.delete(cacheKey)
        }, () => cache.delete(cacheKey))
      }
    }
    return mapKbVersionToCitation(await pending, citation)
  }
}

let registered = false

export function ensureKbCitationResolver(): void {
  if (registered || typeof window === 'undefined') return
  registered = true
  registerCitationResolver(KB_CITATION_KIND, createKbCitationResolver())
}
