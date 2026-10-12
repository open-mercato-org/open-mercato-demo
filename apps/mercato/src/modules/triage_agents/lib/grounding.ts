import type { KbArticlePolicy } from './kbArticles'
import { parseCitationRef } from './kbArticles'
import { isRecord, parseMaybeJsonRecord } from './projection'

export type GroundingVerdict = {
  state: 'verified' | 'unverified'
  issues: string[]
  articleRefs: string[]
}

type ArticleLoader = (key: string, version: number) => Promise<KbArticlePolicy | null>

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function anchorExists(article: KbArticlePolicy, anchor: string): boolean {
  if (anchor === 'reply_template') return true
  if (anchor.startsWith('check:')) return article.requiredChecks.some((check) => check.key === anchor.slice('check:'.length))
  return article.procedureSteps.some((step) => step.id === anchor)
}

/**
 * Fallback KB grounding check (spec "KB grounding", Guardrail layer): every cited
 * article version must exist, every cited step / check must exist in that version,
 * every proposed action type must be one the article recommends, and every required
 * check must be reported. AO grounding sets cannot do this because AO resolves
 * citations against the context bundle only, never against tool results.
 */
export async function verifyProposalGrounding(payload: unknown, loadArticle: ArticleLoader): Promise<GroundingVerdict> {
  const root = parseMaybeJsonRecord(payload)
  const proposal = root && isRecord(root.proposal) ? root.proposal : root
  const evidence = proposal && isRecord(proposal.evidence) ? proposal.evidence : null
  const issues: string[] = []
  const citations = Array.isArray(evidence?.citations) ? evidence.citations.filter(isRecord) : []
  if (citations.length === 0) {
    return { state: 'unverified', issues: ['The proposal cites no knowledge base article.'], articleRefs: [] }
  }
  const articles = new Map<string, KbArticlePolicy>()
  for (const citation of citations) {
    const ref = typeof citation.ref === 'string' ? citation.ref : ''
    const parsed = parseCitationRef(ref)
    if (!parsed) {
      issues.push(`Citation "${ref}" is not a key@version reference.`)
      continue
    }
    const base = `${parsed.key}@${parsed.version}`
    if (!articles.has(base)) {
      const article = await loadArticle(parsed.key, parsed.version)
      if (!article) {
        issues.push(`Article ${base} does not exist.`)
        continue
      }
      articles.set(base, article)
    }
    const article = articles.get(base)
    if (!article) continue
    for (const step of readStrings(citation.steps)) {
      if (!anchorExists(article, step)) issues.push(`${base} has no step ${step}.`)
    }
  }
  const checks = Array.isArray(evidence?.checks) ? evidence.checks.filter(isRecord) : []
  const reportedChecks = new Set(checks.map((check) => (typeof check.key === 'string' ? check.key : '')))
  for (const article of articles.values()) {
    for (const required of article.requiredChecks) {
      if (!reportedChecks.has(required.key)) issues.push(`Required check ${required.key} of ${article.key}@${article.version} is not reported.`)
    }
    for (const check of checks) {
      const step = typeof check.step === 'string' ? check.step : null
      if (step && !article.procedureSteps.some((entry) => entry.id === step)) {
        issues.push(`Check ${String(check.key)} cites ${step}, which ${article.key}@${article.version} does not have.`)
      }
    }
  }
  const recommended = new Set([...articles.values()].flatMap((article) => article.recommendedActions.map((action) => action.actionKey)))
  const options = Array.isArray(proposal?.options) ? proposal.options.filter(isRecord) : []
  for (const option of options) {
    const actions = Array.isArray(option.actions) ? option.actions.filter(isRecord) : []
    for (const action of actions) {
      const type = typeof action.type === 'string' ? action.type : ''
      if (articles.size > 0 && !recommended.has(type)) issues.push(`Action ${type} is not recommended by the cited article.`)
      for (const ref of readStrings(action.citations)) {
        const parsed = parseCitationRef(ref)
        if (!parsed) {
          issues.push(`Action citation "${ref}" is not a key@version reference.`)
          continue
        }
        const article = articles.get(`${parsed.key}@${parsed.version}`)
        if (!article) {
          issues.push(`Action citation ${ref} names an article the proposal does not cite.`)
          continue
        }
        if (parsed.anchor && !anchorExists(article, parsed.anchor)) issues.push(`Action citation ${ref} names a step the article does not have.`)
      }
    }
  }
  return {
    state: issues.length === 0 ? 'verified' : 'unverified',
    issues: issues.slice(0, 20),
    articleRefs: [...articles.keys()],
  }
}
