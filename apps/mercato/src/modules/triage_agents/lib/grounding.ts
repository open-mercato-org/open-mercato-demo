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

export const KB_GET_ARTICLE_TOOL = 'knowledge_articles.get_article'
export const KB_NOT_CONSULTED_REASON_CODE = 'kb_not_consulted'
export const KB_NOT_CONSULTED_REASON =
  'The resolution advisor did not read the knowledge base article it cites; review the proposal manually.'

export type RecordedToolCall = {
  toolName: string
  status?: string | null
  requestSummary?: unknown
  responseSummary?: unknown
}

export type KbConsultation = {
  consulted: boolean
  issues: string[]
  readRefs: string[]
}

type ArticleRead = { key: string; version: number | null }

function normalizeToolName(name: string): string {
  return name.replace(/__/g, '.')
}

function readPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function readArticleRead(call: RecordedToolCall): ArticleRead | null {
  const response = parseMaybeJsonRecord(call.responseSummary)
  const request = parseMaybeJsonRecord(call.requestSummary)
  const preview = response && typeof response.preview === 'string' ? response.preview : null
  if (response?.found === false || (preview && /"found"\s*:\s*false/.test(preview))) return null
  if (response && typeof response.key === 'string') return { key: response.key, version: readPositiveInt(response.version) }
  const fromPreview = preview ? /"citation"\s*:\s*"([^"@]+)@(\d+)"/.exec(preview) : null
  if (fromPreview) return { key: fromPreview[1], version: Number(fromPreview[2]) }
  if (request && typeof request.key === 'string') return { key: request.key, version: readPositiveInt(request.version) }
  return null
}

/**
 * Fail-closed KB consultation check over the advisor run's recorded tool calls:
 * every article the proposal cites must have been fetched successfully
 * (`found !== false`) with `knowledge_articles.get_article` during that run. A
 * proposal citing an article it never read is a guess, however plausible its keys.
 */
export function assessKbConsultation(toolCalls: RecordedToolCall[], citedRefs: string[]): KbConsultation {
  const reads = toolCalls
    .filter((call) => normalizeToolName(call.toolName) === KB_GET_ARTICLE_TOOL && (call.status ?? 'ok') === 'ok')
    .map(readArticleRead)
    .filter((entry): entry is ArticleRead => entry !== null)
  const readRefs = reads.map((entry) => (entry.version ? `${entry.key}@${entry.version}` : entry.key))
  if (reads.length === 0) {
    return {
      consulted: false,
      issues: ['The advisor did not read the knowledge base article (no successful knowledge_articles.get_article call).'],
      readRefs,
    }
  }
  const issues: string[] = []
  for (const ref of citedRefs) {
    const parsed = parseCitationRef(ref)
    if (!parsed) continue
    const read = reads.some((entry) => entry.key === parsed.key && (entry.version === null || entry.version === parsed.version))
    if (!read) issues.push(`Article ${parsed.key}@${parsed.version} is cited but was never read with knowledge_articles.get_article.`)
  }
  return { consulted: issues.length === 0, issues, readRefs }
}
