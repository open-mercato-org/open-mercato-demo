import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CategoryEditForm } from '../../../../components/CategoryForm'

export default function EditKnowledgeCategoryPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  if (!id) return null
  return (
    <Page>
      <PageBody>
        <CategoryEditForm id={id} />
      </PageBody>
    </Page>
  )
}
