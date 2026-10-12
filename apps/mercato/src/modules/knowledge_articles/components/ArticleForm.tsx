"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ArticleListItem } from '../api/articles/route'
import { validateArticleStructure } from '../lib/articleStructure'
import extensionPoints from '../extension-points'
import {
  ProcedureStepsEditor,
  RecommendedActionsEditor,
  ReplyTemplateEditor,
  RequiredChecksEditor,
} from './ArticleEditors'
import { ArticleStatusBadge } from './AutomationLevelBadge'
import {
  readActionRows,
  readCheckRows,
  readStepRows,
  toActionPayload,
  toCheckPayload,
  toStepPayload,
} from './editorValues'
import { buildSubcategoryOptions, useKnowledgeCategories } from './useCategoryOptions'

const ENTITY_ID = extensionPoints.hosts.articleForm.entityId.replace('.', ':')
const LIST_HREF = '/backend/knowledge'
const API_PATH = 'knowledge_articles/articles'
const NONE_VALUE = ''

type Translate = ReturnType<typeof useT>

export type ArticleFormValues = {
  id?: string
  title: string
  key: string
  categoryId: string
  summary: string
  keywords: string[]
  applicability: string
  body: string
  procedureSteps: unknown
  requiredChecks: unknown
  recommendedActions: unknown
  automationLevel: string
  manualReason: string
  targetQueueKey: string
  priorityFloor: string
  replyTemplate: string
  status?: string
  version?: number
  updatedAt?: string | null
}

export function toArticleFormValues(item: ArticleListItem): ArticleFormValues {
  return {
    id: item.id,
    title: item.title,
    key: item.key,
    categoryId: item.categoryId ?? '',
    summary: item.summary ?? '',
    keywords: item.keywords ?? [],
    applicability: item.applicability ?? '',
    body: item.body ?? '',
    procedureSteps: item.procedureSteps ?? [],
    requiredChecks: item.requiredChecks ?? [],
    recommendedActions: item.recommendedActions ?? [],
    automationLevel: item.automationLevel,
    manualReason: item.manualReason ?? '',
    targetQueueKey: item.targetQueueKey ?? '',
    priorityFloor: item.priorityFloor ?? NONE_VALUE,
    replyTemplate: item.replyTemplate ?? '',
    status: item.status,
    version: item.version,
    updatedAt: item.updatedAt ?? null,
  }
}

function emptyToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function buildArticlePayload(values: Partial<ArticleFormValues>, t: Translate): Record<string, unknown> {
  const procedureSteps = toStepPayload(readStepRows(values.procedureSteps))
  const requiredChecks = toCheckPayload(readCheckRows(values.requiredChecks))
  const recommendedActions = toActionPayload(readActionRows(values.recommendedActions))
  const issues = validateArticleStructure({ procedureSteps, requiredChecks, recommendedActions })
  if (issues.length) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of issues) {
      if (!fieldErrors[issue.field]) fieldErrors[issue.field] = t(issue.messageKey)
    }
    throw createCrudFormError(t(issues[0].messageKey), fieldErrors)
  }
  return {
    ...(values.id ? { id: values.id } : {}),
    title: values.title?.trim() ?? '',
    key: values.key?.trim() ?? '',
    categoryId: values.categoryId,
    summary: emptyToNull(values.summary),
    keywords: Array.isArray(values.keywords) ? values.keywords : [],
    applicability: emptyToNull(values.applicability),
    body: emptyToNull(values.body),
    procedureSteps,
    requiredChecks,
    recommendedActions,
    automationLevel: values.automationLevel || 'manual_only',
    manualReason: emptyToNull(values.manualReason),
    targetQueueKey: emptyToNull(values.targetQueueKey),
    priorityFloor: values.priorityFloor ? values.priorityFloor : null,
    replyTemplate: emptyToNull(values.replyTemplate),
  }
}

function useArticleFields(t: Translate, categoryOptions: Array<{ value: string; label: string }>): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'title', label: t('knowledge_articles.form.fields.title'), type: 'text', required: true },
    {
      id: 'key',
      label: t('knowledge_articles.form.fields.key'),
      type: 'text',
      required: true,
      placeholder: 'payments.refunds.overpayment_refund',
      description: t('knowledge_articles.form.fields.keyHelp'),
    },
    {
      id: 'categoryId',
      label: t('knowledge_articles.form.fields.category'),
      type: 'select',
      required: true,
      options: categoryOptions,
      description: t('knowledge_articles.form.fields.categoryHelp'),
    },
    { id: 'summary', label: t('knowledge_articles.form.fields.summary'), type: 'textarea', rows: 2 },
    { id: 'keywords', label: t('knowledge_articles.form.fields.keywords'), type: 'tags' },
    {
      id: 'applicability',
      label: t('knowledge_articles.form.fields.applicability'),
      type: 'textarea',
      rows: 3,
      description: t('knowledge_articles.form.fields.applicabilityHelp'),
    },
    { id: 'body', label: t('knowledge_articles.form.fields.body'), type: 'textarea', rows: 6 },
    {
      id: 'procedureSteps',
      label: t('knowledge_articles.form.fields.procedureSteps'),
      type: 'custom',
      rendersOwnError: true,
      component: ProcedureStepsEditor,
    },
    {
      id: 'requiredChecks',
      label: t('knowledge_articles.form.fields.requiredChecks'),
      type: 'custom',
      rendersOwnError: true,
      component: RequiredChecksEditor,
    },
    {
      id: 'recommendedActions',
      label: t('knowledge_articles.form.fields.recommendedActions'),
      type: 'custom',
      rendersOwnError: true,
      component: RecommendedActionsEditor,
    },
    {
      id: 'automationLevel',
      label: t('knowledge_articles.form.fields.automationLevel'),
      type: 'select',
      required: true,
      options: [
        { value: 'assisted', label: t('knowledge_articles.automation.assisted') },
        { value: 'manual_only', label: t('knowledge_articles.automation.manual_only') },
      ],
      description: t('knowledge_articles.form.fields.automationLevelHelp'),
    },
    {
      id: 'manualReason',
      label: t('knowledge_articles.form.fields.manualReason'),
      type: 'textarea',
      rows: 2,
    },
    {
      id: 'targetQueueKey',
      label: t('knowledge_articles.form.fields.targetQueueKey'),
      type: 'text',
      placeholder: 'complaints',
    },
    {
      id: 'priorityFloor',
      label: t('knowledge_articles.form.fields.priorityFloor'),
      type: 'select',
      options: [
        { value: 'low', label: t('knowledge_articles.priority.low') },
        { value: 'normal', label: t('knowledge_articles.priority.normal') },
        { value: 'high', label: t('knowledge_articles.priority.high') },
        { value: 'urgent', label: t('knowledge_articles.priority.urgent') },
      ],
    },
    {
      id: 'replyTemplate',
      label: t('knowledge_articles.form.fields.replyTemplate'),
      type: 'custom',
      rendersOwnError: true,
      component: ReplyTemplateEditor,
    },
  ], [t, categoryOptions])
}

function useArticleGroups(t: Translate, extraGroup: CrudFormGroup | null): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => {
    const groups: CrudFormGroup[] = [
      {
        id: 'content',
        title: t('knowledge_articles.form.groups.content'),
        column: 1,
        fields: ['title', 'key', 'categoryId', 'summary', 'keywords', 'applicability', 'body'],
      },
      {
        id: 'policy',
        title: t('knowledge_articles.form.groups.policy'),
        column: 2,
        fields: ['automationLevel', 'manualReason', 'targetQueueKey', 'priorityFloor'],
      },
      { id: 'procedure', title: t('knowledge_articles.form.groups.procedure'), column: 1, fields: ['procedureSteps'] },
      { id: 'checks', title: t('knowledge_articles.form.groups.checks'), column: 1, fields: ['requiredChecks'] },
      { id: 'actions', title: t('knowledge_articles.form.groups.actions'), column: 1, fields: ['recommendedActions'] },
      { id: 'template', title: t('knowledge_articles.form.groups.template'), column: 1, fields: ['replyTemplate'] },
    ]
    if (extraGroup) groups.splice(2, 0, extraGroup)
    return groups
  }, [t, extraGroup])
}

const EMPTY_VALUES: ArticleFormValues = {
  title: '',
  key: '',
  categoryId: '',
  summary: '',
  keywords: [],
  applicability: '',
  body: '',
  procedureSteps: [],
  requiredChecks: [],
  recommendedActions: [],
  automationLevel: 'manual_only',
  manualReason: '',
  targetQueueKey: '',
  priorityFloor: NONE_VALUE,
  replyTemplate: '',
}

export function ArticleCreateForm({ initialCategoryId }: { initialCategoryId?: string | null }) {
  const t = useT()
  const router = useRouter()
  const { rows } = useKnowledgeCategories()
  const categoryOptions = React.useMemo(() => buildSubcategoryOptions(rows), [rows])
  const fields = useArticleFields(t, categoryOptions)
  const groups = useArticleGroups(t, null)
  const initialValues = React.useMemo<ArticleFormValues>(
    () => ({ ...EMPTY_VALUES, categoryId: initialCategoryId ?? '' }),
    [initialCategoryId],
  )

  return (
    <CrudForm<ArticleFormValues>
      title={t('knowledge_articles.form.create.title')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      cancelHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('knowledge_articles.form.create.submit')}
      onSubmit={async (values) => {
        const payload = buildArticlePayload(values, t)
        const call = await createCrud<{ id?: string }>(API_PATH, payload)
        const createdId = call.result?.id
        flash(t('knowledge_articles.form.flash.created'), 'success')
        router.push(createdId ? `/backend/knowledge/articles/${createdId}` : LIST_HREF)
      }}
    />
  )
}

export function ArticleEditForm({ id }: { id: string }) {
  const t = useT()
  const { rows } = useKnowledgeCategories()
  const categoryOptions = React.useMemo(() => buildSubcategoryOptions(rows), [rows])
  const fields = useArticleFields(t, categoryOptions)
  const [initial, setInitial] = React.useState<ArticleFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [publishing, setPublishing] = React.useState(false)
  const mutationContextId = `knowledge-article-${id}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      setNotFound(false)
      try {
        const data = await fetchCrudList<ArticleListItem>(API_PATH, { ids: id, pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toArticleFormValues(item))
      } catch (error: unknown) {
        if (cancelled) return
        if ((error as { status?: number }).status === 404) setNotFound(true)
        else setLoadError(error instanceof Error && error.message ? error.message : t('knowledge_articles.form.error.load'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, reloadToken, t])

  const handlePublish = React.useCallback(async () => {
    if (!initial) return
    setPublishing(true)
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(initial.updatedAt ?? null),
          () => apiCallOrThrow<{ version?: number }>(`/api/knowledge_articles/articles/${id}/publish`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          }, { errorMessage: t('knowledge_articles.form.error.publish') }),
        ),
        mutationPayload: { id },
        context: {
          formId: mutationContextId,
          resourceKind: 'knowledge_articles.article',
          resourceId: id,
          retryLastMutation,
        },
      })
      flash(t('knowledge_articles.form.flash.published'), 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: () => setReloadToken((token) => token + 1) })) return
      flash(error instanceof Error && error.message ? error.message : t('knowledge_articles.form.error.publish'), 'error')
    } finally {
      setPublishing(false)
    }
  }, [id, initial, mutationContextId, retryLastMutation, runMutation, t])

  const publicationGroup = React.useMemo<CrudFormGroup>(() => ({
    id: 'publication',
    title: t('knowledge_articles.form.groups.publication'),
    column: 2,
    component: () => (
      <div className="space-y-3 text-sm" data-testid="knowledge-publication">
        <ArticleStatusBadge status={initial?.status} version={initial?.version ?? 0} />
        <p className="text-muted-foreground">{t('knowledge_articles.form.publication.help')}</p>
        <Button type="button" onClick={handlePublish} disabled={publishing || !initial}>
          {publishing ? t('knowledge_articles.form.publication.publishing') : t('knowledge_articles.form.publication.publish')}
        </Button>
      </div>
    ),
  }), [handlePublish, initial, publishing, t])
  const groups = useArticleGroups(t, publicationGroup)

  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('knowledge_articles.form.flash.deleted'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('knowledge_articles.form.error.notFound')}
        backHref={LIST_HREF}
        backLabel={t('knowledge_articles.form.backToList')}
      />
    )
  }
  if (loadError) return <ErrorMessage label={loadError} />

  return (
    <CrudForm<ArticleFormValues>
      key={`${id}-${initial?.updatedAt ?? 'loading'}`}
      title={initial?.title || t('knowledge_articles.form.edit.title')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      cancelHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? { ...EMPTY_VALUES, id, updatedAt: null }}
      isLoading={loading}
      loadingMessage={t('knowledge_articles.form.loading')}
      submitLabel={t('knowledge_articles.form.edit.submit')}
      deleteRedirect={deleteRedirect}
      onSubmit={async (values) => {
        await updateCrud(API_PATH, buildArticlePayload({ ...values, id }, t))
        flash(t('knowledge_articles.form.flash.saved'), 'success')
        setReloadToken((token) => token + 1)
      }}
      onDelete={async () => {
        await deleteCrud(API_PATH, id)
      }}
    />
  )
}
