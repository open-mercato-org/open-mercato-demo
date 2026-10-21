import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ArticleEditForm } from '../../../../components/ArticleForm'

export default function EditKnowledgeArticlePage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  if (!id) return null
  return (
    <Page>
      <PageBody>
        <ArticleEditForm id={id} />
      </PageBody>
    </Page>
  )
}
