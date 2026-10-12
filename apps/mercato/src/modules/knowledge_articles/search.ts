import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultLink,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { KNOWLEDGE_ARTICLE_ENTITY_ID } from './commands/shared'
import { readString, readStringArray } from './lib/serialization'

export function isPublishedRecord(record: Record<string, unknown>): boolean {
  return readString(record, 'status') === 'published'
}

function articleUrl(record: Record<string, unknown>): string | null {
  const id = readString(record, 'id')
  return id ? `/backend/knowledge/articles/${id}` : null
}

function presenterFor(record: Record<string, unknown>): SearchResultPresenter {
  const title = readString(record, 'title') ?? readString(record, 'key') ?? 'Knowledge article'
  const key = readString(record, 'key')
  const version = record.version
  return {
    title,
    subtitle: key ? (typeof version === 'number' ? `${key}@${version}` : key) : undefined,
    icon: 'book-open',
    badge: readString(record, 'automation_level', 'automationLevel') ?? undefined,
  }
}

function pushLine(lines: string[], label: string, value: string | null): void {
  if (!value) return
  const trimmed = value.trim()
  if (trimmed.length) lines.push(`${label}: ${trimmed}`)
}

export function buildArticleSearchText(record: Record<string, unknown>): string[] {
  const lines: string[] = []
  pushLine(lines, 'Title', readString(record, 'title'))
  pushLine(lines, 'Key', readString(record, 'key'))
  pushLine(lines, 'Summary', readString(record, 'summary'))
  pushLine(lines, 'Applicability', readString(record, 'applicability'))
  const keywords = readStringArray(record, 'keywords')
  if (keywords.length) lines.push(`Keywords: ${keywords.join(', ')}`)
  pushLine(lines, 'Background', readString(record, 'body'))
  return lines
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: KNOWLEDGE_ARTICLE_ENTITY_ID,
      enabled: true,
      priority: 15,
      strategies: ['fulltext', 'vector', 'tokens'],

      buildSource: (ctx: SearchBuildContext): SearchIndexSource | null => {
        const record = ctx.record
        if (!isPublishedRecord(record)) return null
        const lines = buildArticleSearchText(record)
        if (!lines.length) return null
        const presenter = presenterFor(record)
        const url = articleUrl(record)
        const links: SearchResultLink[] = url ? [{ href: url, label: presenter.title, kind: 'primary' }] : []
        return {
          text: lines,
          presenter,
          links,
          checksumSource: {
            title: record.title ?? null,
            summary: record.summary ?? null,
            applicability: record.applicability ?? null,
            keywords: record.keywords ?? null,
            body: record.body ?? null,
            status: record.status ?? null,
            version: record.version ?? null,
          },
        }
      },

      formatResult: (ctx: SearchBuildContext): SearchResultPresenter | null => presenterFor(ctx.record),

      resolveUrl: (ctx: SearchBuildContext): string | null => articleUrl(ctx.record),

      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        const url = articleUrl(ctx.record)
        if (!url) return null
        const { t } = await resolveTranslations()
        return [{ href: url, label: t('knowledge_articles.search.openArticle', 'Open article'), kind: 'secondary' }]
      },

      fieldPolicy: {
        searchable: ['title', 'key', 'summary', 'applicability', 'keywords', 'body'],
        excluded: [
          'tenant_id',
          'organization_id',
          'deleted_at',
          'reply_template',
          'procedure_steps',
          'required_checks',
          'recommended_actions',
        ],
      },
      aclFeatures: ['knowledge_articles.view'],
    },
  ],
}

export default searchConfig
