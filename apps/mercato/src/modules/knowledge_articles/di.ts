import { asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createKnowledgeArticleVersionReader, KNOWLEDGE_ARTICLE_VERSION_READER } from './lib/versionReader'

type KnowledgeArticlesCradle = AppContainer['cradle'] & {
  em: EntityManager
}

export function register(container: AppContainer) {
  container.register({
    [KNOWLEDGE_ARTICLE_VERSION_READER]: asFunction(({ em }: KnowledgeArticlesCradle) => createKnowledgeArticleVersionReader(em))
      .singleton()
      .proxy(),
  })
}
