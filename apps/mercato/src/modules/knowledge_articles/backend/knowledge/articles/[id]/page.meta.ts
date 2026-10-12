export const metadata = {
  requireAuth: true,
  requireFeatures: ['knowledge_articles.manage'],
  pageTitle: 'Edit article',
  pageTitleKey: 'knowledge_articles.form.edit.title',
  pageGroup: 'Knowledge base',
  pageGroupKey: 'knowledge_articles.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Knowledge base', labelKey: 'knowledge_articles.nav.title', href: '/backend/knowledge' },
    { label: 'Edit article', labelKey: 'knowledge_articles.form.edit.title' },
  ],
}
