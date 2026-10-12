import {
  crudFormExtensionHost,
  dataTableExtensionHost,
  defineModuleExtensionPoints,
} from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'knowledge_articles',
  hosts: {
    articlesTable: dataTableExtensionHost({
      tableId: 'knowledge_articles.articles.list',
      source: 'components/KnowledgeBrowser.tsx',
    }),
    articleForm: crudFormExtensionHost({
      entityId: 'knowledge_articles.knowledge_article',
      spotId: 'crud-form:knowledge_articles.knowledge_article',
      source: 'components/ArticleForm.tsx',
    }),
  },
})

export default extensionPoints
