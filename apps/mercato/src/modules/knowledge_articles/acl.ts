export const features = [
  { id: 'knowledge_articles.view', title: 'View knowledge base', module: 'knowledge_articles' },
  {
    id: 'knowledge_articles.manage',
    title: 'Manage knowledge base',
    module: 'knowledge_articles',
    dependsOn: ['knowledge_articles.view'],
  },
]

export default features
