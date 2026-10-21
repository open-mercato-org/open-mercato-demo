"use client"

import * as React from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type RowControlsProps = {
  index: number
  count: number
  disabled?: boolean
  onMove?: (from: number, to: number) => void
  onRemove: (index: number) => void
}

export function RowControls({ index, count, disabled, onMove, onRemove }: RowControlsProps) {
  const t = useT()
  return (
    <div className="flex shrink-0 items-start gap-1">
      {onMove ? (
        <>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || index === 0}
            aria-label={t('knowledge_articles.editor.rows.moveUp')}
            title={t('knowledge_articles.editor.rows.moveUp')}
            onClick={() => onMove(index, index - 1)}
          >
            <ArrowUp className="size-4" aria-hidden />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || index >= count - 1}
            aria-label={t('knowledge_articles.editor.rows.moveDown')}
            title={t('knowledge_articles.editor.rows.moveDown')}
            onClick={() => onMove(index, index + 1)}
          >
            <ArrowDown className="size-4" aria-hidden />
          </IconButton>
        </>
      ) : null}
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label={t('knowledge_articles.editor.rows.remove')}
        title={t('knowledge_articles.editor.rows.remove')}
        onClick={() => onRemove(index)}
      >
        <Trash2 className="size-4" aria-hidden />
      </IconButton>
    </div>
  )
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
