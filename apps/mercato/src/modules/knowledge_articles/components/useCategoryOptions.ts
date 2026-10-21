"use client"

import * as React from 'react'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

export type CategoryRow = {
  id: string
  parentId: string | null
  level: 'category' | 'subcategory'
  key: string
  name: string
  description: string | null
  position: number
  isActive: boolean
  updatedAt: string | null
}

export type CategoryOption = { value: string; label: string }

export function buildSubcategoryOptions(rows: CategoryRow[]): CategoryOption[] {
  const parents = new Map(rows.filter((row) => row.level === 'category').map((row) => [row.id, row]))
  return rows
    .filter((row) => row.level === 'subcategory')
    .map((row) => {
      const parent = row.parentId ? parents.get(row.parentId) : undefined
      return { value: row.id, label: parent ? `${parent.name} › ${row.name}` : row.name }
    })
    .sort((left, right) => left.label.localeCompare(right.label))
}

export function useKnowledgeCategories(reloadToken = 0): {
  rows: CategoryRow[]
  isLoading: boolean
  error: string | null
} {
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<CategoryRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    fetchCrudList<CategoryRow>('knowledge_articles/categories', { pageSize: 100, sortField: 'position', sortDir: 'asc' })
      .then((data) => {
        if (!cancelled) setRows(Array.isArray(data?.items) ? data.items : [])
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scopeVersion, reloadToken])

  return { rows, isLoading, error }
}
