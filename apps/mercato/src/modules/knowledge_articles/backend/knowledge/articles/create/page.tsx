"use client"

import { useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ArticleCreateForm } from '../../../../components/ArticleForm'

export default function CreateKnowledgeArticlePage() {
  const searchParams = useSearchParams()
  return (
    <Page>
      <PageBody>
        <ArticleCreateForm initialCategoryId={searchParams?.get('categoryId') ?? null} />
      </PageBody>
    </Page>
  )
}
