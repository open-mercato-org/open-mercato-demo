"use client"

import * as React from 'react'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { nextStepId, renumberSteps } from '../lib/articleStructure'
import { extractTemplatePlaceholders } from '../lib/templates'
import { RowControls, moveItem } from './RowControls'
import {
  readActionRows,
  readCheckRows,
  readStepRows,
  type ActionRow,
  type CheckRow,
  type StepRow,
} from './editorValues'

const NONE_VALUE = '__none__'

export const KNOWN_TEMPLATE_PLACEHOLDERS = [
  'customer.firstName',
  'customer.lastName',
  'reservation.bookingNumber',
  'reservation.departureDate',
  'refund.amount',
  'payment.amount',
] as const

function EditorError({ error }: { error?: string }) {
  if (!error) return null
  return <p className="text-sm text-destructive">{error}</p>
}

export function ProcedureStepsEditor({ value, setValue, values, disabled, error }: CrudCustomFieldRenderProps) {
  const t = useT()
  const rows = readStepRows(value)
  const checks = readCheckRows(values?.requiredChecks).filter((check) => check.key.trim().length > 0)
  const actions = readActionRows(values?.recommendedActions).filter((action) => action.actionKey.trim().length > 0)
  const update = (index: number, patch: Partial<StepRow>) => {
    setValue(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  }
  return (
    <div className="space-y-3" data-testid="knowledge-procedure-steps">
      <p className="text-sm text-muted-foreground">{t('knowledge_articles.editor.steps.help')}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('knowledge_articles.editor.steps.empty')}</p>
      ) : null}
      {rows.map((row, index) => (
        <div key={`${row.id}-${index}`} className="flex gap-3 rounded-md border border-border p-3">
          <span className="mt-2 w-10 shrink-0 font-mono text-sm font-semibold">{row.id}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Textarea
              value={row.text}
              disabled={disabled}
              rows={2}
              aria-label={t('knowledge_articles.editor.steps.text')}
              placeholder={t('knowledge_articles.editor.steps.textPlaceholder')}
              onChange={(event) => update(index, { text: event.target.value })}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                value={row.checkKey ?? NONE_VALUE}
                disabled={disabled}
                onValueChange={(next) => update(index, { checkKey: next === NONE_VALUE ? null : next })}
              >
                <SelectTrigger size="sm" aria-label={t('knowledge_articles.editor.steps.check')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t('knowledge_articles.editor.steps.noCheck')}</SelectItem>
                  {checks.map((check) => (
                    <SelectItem key={check.key} value={check.key}>{check.label || check.key}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={row.actionKey ?? NONE_VALUE}
                disabled={disabled}
                onValueChange={(next) => update(index, { actionKey: next === NONE_VALUE ? null : next })}
              >
                <SelectTrigger size="sm" aria-label={t('knowledge_articles.editor.steps.action')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t('knowledge_articles.editor.steps.noAction')}</SelectItem>
                  {actions.map((action) => (
                    <SelectItem key={action.actionKey} value={action.actionKey}>{action.label || action.actionKey}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <RowControls
            index={index}
            count={rows.length}
            disabled={disabled}
            onMove={(from, to) => setValue(renumberSteps(moveItem(rows, from, to)))}
            onRemove={(removeIndex) => setValue(rows.filter((_row, rowIndex) => rowIndex !== removeIndex))}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setValue([...rows, { id: nextStepId(rows), text: '', checkKey: null, actionKey: null }])}
      >
        <Plus className="size-4" aria-hidden />
        {t('knowledge_articles.editor.steps.add')}
      </Button>
      <EditorError error={error} />
    </div>
  )
}

export function RequiredChecksEditor({ value, setValue, disabled, error }: CrudCustomFieldRenderProps) {
  const t = useT()
  const rows = readCheckRows(value)
  const update = (index: number, patch: Partial<CheckRow>) => {
    setValue(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  }
  return (
    <div className="space-y-3" data-testid="knowledge-required-checks">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('knowledge_articles.editor.checks.empty')}</p>
      ) : null}
      {rows.map((row, index) => (
        <div key={index} className="flex gap-3 rounded-md border border-border p-3">
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
            <Input
              value={row.key}
              disabled={disabled}
              aria-label={t('knowledge_articles.editor.checks.key')}
              placeholder={t('knowledge_articles.editor.checks.keyPlaceholder')}
              onChange={(event) => update(index, { key: event.target.value })}
            />
            <Input
              value={row.label}
              disabled={disabled}
              aria-label={t('knowledge_articles.editor.checks.label')}
              placeholder={t('knowledge_articles.editor.checks.labelPlaceholder')}
              onChange={(event) => update(index, { label: event.target.value })}
            />
            <Input
              className="sm:col-span-2"
              value={row.description ?? ''}
              disabled={disabled}
              aria-label={t('knowledge_articles.editor.checks.description')}
              placeholder={t('knowledge_articles.editor.checks.descriptionPlaceholder')}
              onChange={(event) => update(index, { description: event.target.value })}
            />
          </div>
          <RowControls
            index={index}
            count={rows.length}
            disabled={disabled}
            onRemove={(removeIndex) => setValue(rows.filter((_row, rowIndex) => rowIndex !== removeIndex))}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setValue([...rows, { key: '', label: '', description: null }])}
      >
        <Plus className="size-4" aria-hidden />
        {t('knowledge_articles.editor.checks.add')}
      </Button>
      <EditorError error={error} />
    </div>
  )
}

function parsePreconditions(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export function RecommendedActionsEditor({ value, setValue, disabled, error }: CrudCustomFieldRenderProps) {
  const t = useT()
  const rows = readActionRows(value)
  const update = (index: number, patch: Partial<ActionRow>) => {
    setValue(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  }
  return (
    <div className="space-y-3" data-testid="knowledge-recommended-actions">
      <p className="text-sm text-muted-foreground">{t('knowledge_articles.editor.actions.help')}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('knowledge_articles.editor.actions.empty')}</p>
      ) : null}
      {rows.map((row, index) => (
        <div key={index} className="flex gap-3 rounded-md border border-border p-3">
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
            <Input
              value={row.actionKey}
              disabled={disabled}
              aria-label={t('knowledge_articles.editor.actions.actionKey')}
              placeholder={t('knowledge_articles.editor.actions.actionKeyPlaceholder')}
              onChange={(event) => update(index, { actionKey: event.target.value })}
            />
            <Input
              value={row.label}
              disabled={disabled}
              aria-label={t('knowledge_articles.editor.actions.label')}
              placeholder={t('knowledge_articles.editor.actions.labelPlaceholder')}
              onChange={(event) => update(index, { label: event.target.value })}
            />
            <Input
              value={row.preconditions.join(', ')}
              disabled={disabled}
              aria-label={t('knowledge_articles.editor.actions.preconditions')}
              placeholder={t('knowledge_articles.editor.actions.preconditionsPlaceholder')}
              onChange={(event) => update(index, { preconditions: parsePreconditions(event.target.value) })}
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={row.requiresApproval}
                disabled={disabled}
                onCheckedChange={(checked) => update(index, { requiresApproval: checked === true })}
              />
              {t('knowledge_articles.editor.actions.requiresApproval')}
            </label>
          </div>
          <RowControls
            index={index}
            count={rows.length}
            disabled={disabled}
            onRemove={(removeIndex) => setValue(rows.filter((_row, rowIndex) => rowIndex !== removeIndex))}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setValue([...rows, { actionKey: '', label: '', requiresApproval: true, preconditions: [] }])}
      >
        <Plus className="size-4" aria-hidden />
        {t('knowledge_articles.editor.actions.add')}
      </Button>
      <EditorError error={error} />
    </div>
  )
}

export function ReplyTemplateEditor({ value, setValue, disabled, error }: CrudCustomFieldRenderProps) {
  const t = useT()
  const text = typeof value === 'string' ? value : ''
  const used = extractTemplatePlaceholders(text)
  return (
    <div className="space-y-2" data-testid="knowledge-reply-template">
      <Textarea
        value={text}
        disabled={disabled}
        rows={8}
        aria-label={t('knowledge_articles.form.fields.replyTemplate')}
        placeholder={t('knowledge_articles.editor.template.placeholder')}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
        <p className="font-medium">{t('knowledge_articles.editor.template.legendTitle')}</p>
        <ul className="mt-1 flex flex-wrap gap-2">
          {KNOWN_TEMPLATE_PLACEHOLDERS.map((placeholder) => (
            <li key={placeholder}>
              <code className="rounded bg-background px-1 py-0.5 text-xs">{`{{${placeholder}}}`}</code>
            </li>
          ))}
        </ul>
        {used.length ? (
          <p className="mt-2 text-muted-foreground">
            {t('knowledge_articles.editor.template.used', { placeholders: used.join(', ') })}
          </p>
        ) : null}
      </div>
      <EditorError error={error} />
    </div>
  )
}
