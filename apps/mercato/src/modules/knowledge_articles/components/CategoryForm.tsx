"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useKnowledgeCategories, type CategoryRow } from './useCategoryOptions'

const ENTITY_ID = 'knowledge_articles:knowledge_category'
const LIST_HREF = '/backend/knowledge'
const API_PATH = 'knowledge_articles/categories'
const NO_PARENT = ''

type Translate = ReturnType<typeof useT>

export type CategoryFormValues = {
  id?: string
  name: string
  key: string
  level: string
  parentId: string
  description: string
  position: number
  isActive: boolean
  updatedAt?: string | null
}

function useCategoryFields(t: Translate, parents: CategoryRow[]): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('knowledge_articles.categoryForm.fields.name'), type: 'text', required: true },
    {
      id: 'key',
      label: t('knowledge_articles.categoryForm.fields.key'),
      type: 'text',
      required: true,
      placeholder: 'payments.refunds',
      description: t('knowledge_articles.categoryForm.fields.keyHelp'),
    },
    {
      id: 'level',
      label: t('knowledge_articles.categoryForm.fields.level'),
      type: 'select',
      required: true,
      options: [
        { value: 'category', label: t('knowledge_articles.level.category') },
        { value: 'subcategory', label: t('knowledge_articles.level.subcategory') },
      ],
    },
    {
      id: 'parentId',
      label: t('knowledge_articles.categoryForm.fields.parent'),
      type: 'select',
      options: [
        { value: NO_PARENT, label: t('knowledge_articles.categoryForm.fields.noParent') },
        ...parents.map((parent) => ({ value: parent.id, label: parent.name })),
      ],
      visibleWhen: { field: 'level', equals: 'subcategory' },
    },
    { id: 'description', label: t('knowledge_articles.categoryForm.fields.description'), type: 'textarea', rows: 3 },
    { id: 'position', label: t('knowledge_articles.categoryForm.fields.position'), type: 'number' },
    { id: 'isActive', label: t('knowledge_articles.categoryForm.fields.isActive'), type: 'checkbox' },
  ], [t, parents])
}

function useCategoryGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: t('knowledge_articles.categoryForm.groups.details'),
      column: 1,
      fields: ['name', 'key', 'level', 'parentId', 'description', 'position', 'isActive'],
    },
  ], [t])
}

function toPayload(values: Partial<CategoryFormValues>): Record<string, unknown> {
  const level = values.level === 'subcategory' ? 'subcategory' : 'category'
  const position = Number(values.position ?? 0)
  return {
    ...(values.id ? { id: values.id } : {}),
    name: values.name?.trim() ?? '',
    key: values.key?.trim() ?? '',
    level,
    parentId: level === 'subcategory' && values.parentId ? values.parentId : null,
    description: values.description?.trim() ? values.description.trim() : null,
    position: Number.isFinite(position) ? Math.max(0, Math.trunc(position)) : 0,
    isActive: values.isActive !== false,
  }
}

export function CategoryCreateForm({ initialParentId }: { initialParentId?: string | null }) {
  const t = useT()
  const { rows } = useKnowledgeCategories()
  const parents = React.useMemo(() => rows.filter((row) => row.level === 'category'), [rows])
  const fields = useCategoryFields(t, parents)
  const groups = useCategoryGroups(t)
  const initialValues = React.useMemo<CategoryFormValues>(() => ({
    name: '',
    key: '',
    level: initialParentId ? 'subcategory' : 'category',
    parentId: initialParentId ?? NO_PARENT,
    description: '',
    position: 0,
    isActive: true,
  }), [initialParentId])
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('knowledge_articles.categoryForm.flash.created'), 'success'),
    [t],
  )
  return (
    <CrudForm<CategoryFormValues>
      title={t('knowledge_articles.categoryForm.create.title')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      cancelHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('knowledge_articles.categoryForm.create.submit')}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(API_PATH, toPayload(values))
      }}
    />
  )
}

export function CategoryEditForm({ id }: { id: string }) {
  const t = useT()
  const { rows } = useKnowledgeCategories()
  const parents = React.useMemo(() => rows.filter((row) => row.level === 'category' && row.id !== id), [rows, id])
  const fields = useCategoryFields(t, parents)
  const groups = useCategoryGroups(t)
  const [initial, setInitial] = React.useState<CategoryFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      setNotFound(false)
      try {
        const data = await fetchCrudList<CategoryRow>(API_PATH, { ids: id, pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) {
          setInitial({
            id: item.id,
            name: item.name,
            key: item.key,
            level: item.level,
            parentId: item.parentId ?? NO_PARENT,
            description: item.description ?? '',
            position: item.position,
            isActive: item.isActive,
            updatedAt: item.updatedAt ?? null,
          })
        }
      } catch (error: unknown) {
        if (cancelled) return
        if ((error as { status?: number }).status === 404) setNotFound(true)
        else setLoadError(error instanceof Error && error.message ? error.message : t('knowledge_articles.categoryForm.error.load'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, t])

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('knowledge_articles.categoryForm.flash.saved'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('knowledge_articles.categoryForm.flash.deleted'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('knowledge_articles.categoryForm.error.notFound')}
        backHref={LIST_HREF}
        backLabel={t('knowledge_articles.form.backToList')}
      />
    )
  }
  if (loadError) return <ErrorMessage label={loadError} />

  return (
    <CrudForm<CategoryFormValues>
      title={t('knowledge_articles.categoryForm.edit.title')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      cancelHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? { name: '', key: '', level: 'category', parentId: NO_PARENT, description: '', position: 0, isActive: true, id, updatedAt: null }}
      isLoading={loading}
      loadingMessage={t('knowledge_articles.form.loading')}
      submitLabel={t('knowledge_articles.categoryForm.edit.submit')}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      onSubmit={async (values) => {
        await updateCrud(API_PATH, toPayload({ ...values, id }))
      }}
      onDelete={async () => {
        await deleteCrud(API_PATH, id)
      }}
    />
  )
}
