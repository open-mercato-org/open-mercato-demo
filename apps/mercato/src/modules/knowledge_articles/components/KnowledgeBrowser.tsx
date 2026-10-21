"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { Pencil } from 'lucide-react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { ArticleListItem } from '../api/articles/route'
import extensionPoints from '../extension-points'
import { ArticleStatusBadge, AutomationLevelBadge } from './AutomationLevelBadge'
import { useKnowledgeCategories, type CategoryRow } from './useCategoryOptions'

const PAGE_SIZE = 50

type ArticlesResponse = {
  items: ArticleListItem[]
  total: number
  totalPages: number
}

type Selection = { id: string; level: 'category' | 'subcategory' } | null

function selectedCategoryIds(selection: Selection, categories: CategoryRow[]): string[] | null {
  if (!selection) return null
  if (selection.level === 'subcategory') return [selection.id]
  return categories.filter((row) => row.parentId === selection.id).map((row) => row.id)
}

function CategoryTree({
  categories,
  selection,
  onSelect,
}: {
  categories: CategoryRow[]
  selection: Selection
  onSelect: (selection: Selection) => void
}) {
  const t = useT()
  const roots = categories.filter((row) => row.level === 'category')
  const itemClass = (active: boolean) => cn(
    'flex-1 truncate rounded-md px-2 py-1 text-left text-sm hover:bg-muted',
    active && 'bg-muted font-medium',
  )
  return (
    <nav aria-label={t('knowledge_articles.browser.tree.label')} className="space-y-1" data-testid="knowledge-tree">
      <Button
        type="button"
        variant="ghost"
        className={cn('w-full justify-start', !selection && 'bg-muted font-medium')}
        onClick={() => onSelect(null)}
      >
        {t('knowledge_articles.browser.tree.all')}
      </Button>
      {roots.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">{t('knowledge_articles.browser.tree.empty')}</p>
      ) : null}
      {roots.map((root) => (
        <div key={root.id} className="space-y-1">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              className={itemClass(selection?.id === root.id)}
              onClick={() => onSelect({ id: root.id, level: 'category' })}
            >
              {root.name}
            </Button>
            <IconButton asChild variant="ghost" size="sm" aria-label={t('knowledge_articles.browser.tree.edit')}>
              <Link href={`/backend/knowledge/categories/${root.id}`}>
                <Pencil className="size-3.5" aria-hidden />
              </Link>
            </IconButton>
          </div>
          <div className="ml-4 space-y-1 border-l border-border pl-2">
            {categories
              .filter((child) => child.level === 'subcategory' && child.parentId === root.id)
              .map((child) => (
                <div key={child.id} className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className={itemClass(selection?.id === child.id)}
                    onClick={() => onSelect({ id: child.id, level: 'subcategory' })}
                  >
                    {child.name}
                  </Button>
                  <IconButton asChild variant="ghost" size="sm" aria-label={t('knowledge_articles.browser.tree.edit')}>
                    <Link href={`/backend/knowledge/categories/${child.id}`}>
                      <Pencil className="size-3.5" aria-hidden />
                    </Link>
                  </IconButton>
                </div>
              ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

export default function KnowledgeBrowser() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { rows: categories, isLoading: categoriesLoading, error: categoriesError } = useKnowledgeCategories()
  const [selection, setSelection] = React.useState<Selection>(null)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'title', desc: false }])
  const [page, setPage] = React.useState(1)

  const categoryNames = React.useMemo(() => new Map(categories.map((row) => [row.id, row.name])), [categories])

  const params = React.useMemo(() => {
    const query: Record<string, string> = {
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: sorting[0]?.id || 'title',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search) query.q = search
    const ids = selectedCategoryIds(selection, categories)
    if (ids) query.categoryIds = ids.join(',')
    const automation = filterValues.automationLevel
    if (typeof automation === 'string' && automation) query.automationLevel = automation
    const status = filterValues.status
    if (typeof status === 'string' && status) query.status = status
    return query
  }, [categories, filterValues, page, search, selection, sorting])

  const { data, isLoading, error } = useQuery<ArticlesResponse>({
    queryKey: ['knowledge_articles', 'articles', params, scopeVersion],
    queryFn: async () => fetchCrudList<ArticleListItem>('knowledge_articles/articles', params),
  })

  const columns = React.useMemo<ColumnDef<ArticleListItem>[]>(() => [
    { accessorKey: 'title', header: t('knowledge_articles.browser.columns.title'), meta: { priority: 1, truncate: true, maxWidth: '320px' } },
    { accessorKey: 'key', header: t('knowledge_articles.browser.columns.key'), meta: { priority: 3, truncate: true, maxWidth: '280px' } },
    {
      accessorKey: 'categoryId',
      header: t('knowledge_articles.browser.columns.subcategory'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) => categoryNames.get(row.original.categoryId ?? '') ?? '—',
    },
    {
      accessorKey: 'automationLevel',
      header: t('knowledge_articles.browser.columns.automation'),
      meta: { priority: 2 },
      cell: ({ row }) => <AutomationLevelBadge level={row.original.automationLevel} />,
    },
    {
      accessorKey: 'status',
      header: t('knowledge_articles.browser.columns.status'),
      meta: { priority: 2 },
      cell: ({ row }) => <ArticleStatusBadge status={row.original.status} version={row.original.version} />,
    },
  ], [categoryNames, t])

  const handleDelete = React.useCallback(async (row: ArticleListItem) => {
    const confirmed = await confirm({ title: t('knowledge_articles.browser.confirmDelete'), variant: 'destructive' })
    if (!confirmed) return
    try {
      await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        () => deleteCrud('knowledge_articles/articles', row.id),
      )
      flash(t('knowledge_articles.form.flash.deleted'), 'success')
      await queryClient.invalidateQueries({ queryKey: ['knowledge_articles', 'articles'] })
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        await queryClient.invalidateQueries({ queryKey: ['knowledge_articles', 'articles'] })
        return
      }
      flash(err instanceof Error && err.message ? err.message : t('knowledge_articles.browser.error.delete'), 'error')
    }
  }, [confirm, queryClient, t])

  const createHref = selection?.level === 'subcategory'
    ? `/backend/knowledge/articles/create?categoryId=${selection.id}`
    : '/backend/knowledge/articles/create'
  const createCategoryHref = selection?.level === 'category'
    ? `/backend/knowledge/categories/create?parentId=${selection.id}`
    : '/backend/knowledge/categories/create'

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="w-full shrink-0 space-y-3 lg:w-72">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('knowledge_articles.browser.tree.title')}</h2>
          <Button asChild variant="outline" size="sm">
            <Link href={createCategoryHref}>{t('knowledge_articles.browser.tree.add')}</Link>
          </Button>
        </div>
        {categoriesLoading ? <LoadingMessage label={t('knowledge_articles.browser.loading')} /> : null}
        {categoriesError ? <ErrorMessage label={categoriesError} /> : null}
        {!categoriesLoading && !categoriesError ? (
          <CategoryTree
            categories={categories}
            selection={selection}
            onSelect={(next) => {
              setSelection(next)
              setPage(1)
            }}
          />
        ) : null}
      </aside>
      <div className="min-w-0 flex-1">
        {ConfirmDialogElement}
        <DataTable<ArticleListItem>
          title={t('knowledge_articles.browser.title')}
          titleHeadingLevel={1}
          actions={(
            <Button asChild>
              <Link href={createHref}>{t('knowledge_articles.browser.actions.create')}</Link>
            </Button>
          )}
          columns={columns}
          data={data?.items ?? []}
          error={error ? t('knowledge_articles.browser.error.load') : null}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('knowledge_articles.browser.searchPlaceholder')}
          filters={[
            {
              id: 'automationLevel',
              label: t('knowledge_articles.browser.columns.automation'),
              type: 'select',
              options: [
                { value: 'assisted', label: t('knowledge_articles.automation.assisted') },
                { value: 'manual_only', label: t('knowledge_articles.automation.manual_only') },
              ],
            },
            {
              id: 'status',
              label: t('knowledge_articles.browser.columns.status'),
              type: 'select',
              options: [
                { value: 'draft', label: t('knowledge_articles.status.draft') },
                { value: 'published', label: t('knowledge_articles.status.published') },
              ],
            },
          ]}
          filterValues={filterValues}
          onFiltersApply={(values) => {
            setFilterValues(values)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilterValues({})
            setPage(1)
          }}
          entityId="knowledge_articles:knowledge_article"
          sortable
          sorting={sorting}
          onSortingChange={(next) => {
            setSorting(next)
            setPage(1)
          }}
          perspective={{ tableId: extensionPoints.hosts.articlesTable.tableId }}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'edit', label: t('knowledge_articles.browser.actions.edit'), href: `/backend/knowledge/articles/${row.id}` },
                { id: 'delete', label: t('knowledge_articles.browser.actions.delete'), destructive: true, onSelect: () => handleDelete(row) },
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/knowledge/articles/${row.id}`)}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total: data?.total ?? 0,
            totalPages: data?.totalPages ?? 0,
            onPageChange: setPage,
          }}
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}
