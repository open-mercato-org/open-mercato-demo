"use client"

import { useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CategoryCreateForm } from '../../../../components/CategoryForm'

export default function CreateKnowledgeCategoryPage() {
  const searchParams = useSearchParams()
  return (
    <Page>
      <PageBody>
        <CategoryCreateForm initialParentId={searchParams?.get('parentId') ?? null} />
      </PageBody>
    </Page>
  )
}
