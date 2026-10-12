import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'knowledge_articles.category.created', label: 'Knowledge Category Created', entity: 'category', category: 'crud' },
  { id: 'knowledge_articles.category.updated', label: 'Knowledge Category Updated', entity: 'category', category: 'crud' },
  { id: 'knowledge_articles.category.deleted', label: 'Knowledge Category Deleted', entity: 'category', category: 'crud' },
  { id: 'knowledge_articles.article.created', label: 'Knowledge Article Created', entity: 'article', category: 'crud' },
  { id: 'knowledge_articles.article.updated', label: 'Knowledge Article Updated', entity: 'article', category: 'crud' },
  { id: 'knowledge_articles.article.deleted', label: 'Knowledge Article Deleted', entity: 'article', category: 'crud' },
  {
    id: 'knowledge_articles.article.published',
    label: 'Knowledge Article Published',
    entity: 'article',
    category: 'lifecycle',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'knowledge_articles',
  events,
})

export const emitKnowledgeArticlesEvent = eventsConfig.emit

export type KnowledgeArticlesEventId = typeof events[number]['id']

export default eventsConfig
