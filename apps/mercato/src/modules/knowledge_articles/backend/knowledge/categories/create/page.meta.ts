export const metadata = {
  requireAuth: true,
  requireFeatures: ['knowledge_articles.manage'],
  pageTitle: 'New category',
  pageTitleKey: 'knowledge_articles.categoryForm.create.title',
  pageGroup: 'Knowledge base',
  pageGroupKey: 'knowledge_articles.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Knowledge base', labelKey: 'knowledge_articles.nav.title', href: '/backend/knowledge' },
    { label: 'New category', labelKey: 'knowledge_articles.categoryForm.create.title' },
  ],
}
