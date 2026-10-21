/**
 * Client-side registry that turns a proposal citation into something a reader can
 * open (spec §A, citations panel). A module that owns a source kind registers a
 * resolver for it — e.g. `kb` → the knowledge-article version endpoint — and the
 * decision card asks the registry before it renders the "Based on" panel.
 *
 * The registry is deliberately dumb: one resolver per kind, last registration
 * wins, and an unknown kind (or a resolver that fails) degrades to the plain
 * label and the citation's own `href`. A citation must never break the card.
 */

export type CitationRef = {
  kind: string
  ref: string
  label?: string | null
  steps?: string[]
  href?: string | null
}

export type ResolvedCitationStep = { id: string; text: string }

export type ResolvedCitation = {
  title: string
  href?: string | null
  steps?: ResolvedCitationStep[]
}

export type CitationResolver = (
  citation: CitationRef,
) => Promise<ResolvedCitation | null> | ResolvedCitation | null

const REGISTRY_KEY = '__openMercatoAgentOrchestratorCitationResolvers__'

type RegistryHost = typeof globalThis & { [REGISTRY_KEY]?: Map<string, CitationResolver> }

function registry(): Map<string, CitationResolver> {
  const host = globalThis as RegistryHost
  if (!host[REGISTRY_KEY]) host[REGISTRY_KEY] = new Map<string, CitationResolver>()
  return host[REGISTRY_KEY]
}

/** Registers (or replaces) the resolver for `kind`; returns an unregister function. */
export function registerCitationResolver(kind: string, resolver: CitationResolver): () => void {
  const map = registry()
  map.set(kind, resolver)
  return () => {
    if (map.get(kind) === resolver) map.delete(kind)
  }
}

export function getCitationResolver(kind: string): CitationResolver | undefined {
  return registry().get(kind)
}

export function listCitationResolverKinds(): string[] {
  return Array.from(registry().keys()).sort()
}

export function fallbackCitation(citation: CitationRef): ResolvedCitation {
  return { title: citation.label || citation.ref, href: citation.href ?? null }
}

/** Resolves through the registered resolver, falling back to the label + `href` on absence or failure. */
export async function resolveCitation(citation: CitationRef): Promise<ResolvedCitation> {
  const resolver = getCitationResolver(citation.kind)
  if (!resolver) return fallbackCitation(citation)
  try {
    const resolved = await resolver(citation)
    if (!resolved) return fallbackCitation(citation)
    return {
      title: resolved.title || citation.label || citation.ref,
      href: resolved.href ?? citation.href ?? null,
      ...(resolved.steps ? { steps: resolved.steps } : {}),
    }
  } catch {
    return fallbackCitation(citation)
  }
}
