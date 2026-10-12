"use client"

import * as React from 'react'
import { Save, Send, StickyNote } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { ticketApiPath, type TicketDraftRow, type TicketRow } from '../ticketTypes'

type ComposerMode = 'reply' | 'note'

type RunMutation = <TResult>(operation: () => Promise<TResult>, payload?: Record<string, unknown>) => Promise<TResult>

export type TicketComposerProps = {
  ticket: TicketRow
  drafts: TicketDraftRow[]
  canReply: boolean
  canManage: boolean
  runMutation: RunMutation
  onChanged: () => Promise<void> | void
}

const NEW_DRAFT_VALUE = '__new__'

type DraftSaveResponse = { draftId: string; created: boolean }
type ReplyResponse = { articleId: string; deliveryStatus: string; alreadySent: boolean }

function postJson(body: Record<string, unknown>, method = 'POST'): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export function TicketComposer({ ticket, drafts, canReply, canManage, runMutation, onChanged }: TicketComposerProps) {
  const t = useT()
  const [mode, setMode] = React.useState<ComposerMode>(canReply ? 'reply' : 'note')
  const [selectedDraftId, setSelectedDraftId] = React.useState<string>(NEW_DRAFT_VALUE)
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')
  const [resolveAfterSend, setResolveAfterSend] = React.useState(false)
  const [busy, setBusy] = React.useState<'save' | 'send' | 'note' | null>(null)
  const isClosed = ticket.status === 'closed'

  const selectedDraft = React.useMemo(
    () => drafts.find((draft) => draft.id === selectedDraftId) ?? null,
    [drafts, selectedDraftId],
  )

  React.useEffect(() => {
    if (selectedDraftId !== NEW_DRAFT_VALUE && !selectedDraft) {
      setSelectedDraftId(NEW_DRAFT_VALUE)
    }
  }, [selectedDraft, selectedDraftId])

  const resetEditor = React.useCallback((draft: TicketDraftRow | null) => {
    setSubject(draft?.subject ?? '')
    setBody(draft?.body ?? '')
  }, [])

  const handleSelectDraft = React.useCallback((value: string) => {
    setSelectedDraftId(value)
    resetEditor(drafts.find((draft) => draft.id === value) ?? null)
  }, [drafts, resetEditor])

  const isDirty = selectedDraft
    ? (selectedDraft.body !== body || (selectedDraft.subject ?? '') !== subject)
    : body.trim().length > 0

  const saveDraft = React.useCallback(async (): Promise<string | null> => {
    const trimmed = body.trim()
    if (!trimmed) return null
    const payload: Record<string, unknown> = {
      body: trimmed,
      subject: subject.trim() ? subject.trim() : null,
    }
    if (selectedDraft) {
      payload.draftId = selectedDraft.id
      const call = await runMutation(
        () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(selectedDraft.updatedAt),
          () => apiCallOrThrow<DraftSaveResponse>(ticketApiPath(ticket.id, 'drafts'), postJson(payload, 'PUT')),
        ),
        payload,
      )
      return call.result?.draftId ?? selectedDraft.id
    }
    const call = await runMutation(
      () => apiCallOrThrow<DraftSaveResponse>(ticketApiPath(ticket.id, 'drafts'), postJson(payload)),
      payload,
    )
    return call.result?.draftId ?? null
  }, [body, runMutation, selectedDraft, subject, ticket.id])

  const handleSaveDraft = React.useCallback(async () => {
    if (!body.trim()) {
      flash(t('tickets.composer.errors.emptyBody', 'Write a message first.'), 'error')
      return
    }
    setBusy('save')
    try {
      const draftId = await saveDraft()
      if (draftId) setSelectedDraftId(draftId)
      flash(t('tickets.composer.flash.draftSaved', 'Draft saved.'), 'success')
      await onChanged()
    } catch (err) {
      flash(err instanceof Error && err.message ? err.message : t('tickets.composer.errors.saveFailed', 'Failed to save the draft.'), 'error')
    } finally {
      setBusy(null)
    }
  }, [body, onChanged, saveDraft, t])

  const handleSend = React.useCallback(async () => {
    if (!body.trim()) {
      flash(t('tickets.composer.errors.emptyBody', 'Write a message first.'), 'error')
      return
    }
    setBusy('send')
    try {
      let draftId: string | null = selectedDraft?.id ?? null
      if (selectedDraft && isDirty) draftId = await saveDraft()
      const payload: Record<string, unknown> = draftId
        ? { draftId, resolveAfterSend }
        : { body: body.trim(), subject: subject.trim() ? subject.trim() : undefined, resolveAfterSend }
      const call = await runMutation(
        () => apiCallOrThrow<ReplyResponse>(ticketApiPath(ticket.id, 'reply'), postJson(payload)),
        payload,
      )
      const status = call.result?.deliveryStatus ?? 'queued'
      flash(
        status === 'simulated'
          ? t('tickets.composer.flash.sentSimulated', 'Reply recorded (simulated delivery).')
          : status === 'failed'
            ? t('tickets.composer.flash.sendFailed', 'Reply recorded, but delivery failed.')
            : t('tickets.composer.flash.sent', 'Reply sent.'),
        status === 'failed' ? 'error' : 'success',
      )
      setSelectedDraftId(NEW_DRAFT_VALUE)
      resetEditor(null)
      setResolveAfterSend(false)
      await onChanged()
    } catch (err) {
      flash(err instanceof Error && err.message ? err.message : t('tickets.composer.errors.sendFailed', 'Failed to send the reply.'), 'error')
    } finally {
      setBusy(null)
    }
  }, [body, isDirty, onChanged, resetEditor, resolveAfterSend, runMutation, saveDraft, selectedDraft, subject, t, ticket.id])

  const handleAddNote = React.useCallback(async () => {
    if (!body.trim()) {
      flash(t('tickets.composer.errors.emptyBody', 'Write a message first.'), 'error')
      return
    }
    setBusy('note')
    try {
      const payload = { body: body.trim() }
      await runMutation(
        () => apiCallOrThrow(ticketApiPath(ticket.id, 'articles'), postJson(payload)),
        payload,
      )
      flash(t('tickets.composer.flash.noteAdded', 'Internal note added.'), 'success')
      resetEditor(null)
      await onChanged()
    } catch (err) {
      flash(err instanceof Error && err.message ? err.message : t('tickets.composer.errors.noteFailed', 'Failed to add the note.'), 'error')
    } finally {
      setBusy(null)
    }
  }, [body, onChanged, resetEditor, runMutation, t, ticket.id])

  const handleCancel = React.useCallback(() => {
    resetEditor(mode === 'reply' ? selectedDraft : null)
  }, [mode, resetEditor, selectedDraft])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (busy) return
      if (mode === 'reply') void handleSend()
      else void handleAddNote()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancel()
    }
  }, [busy, handleAddNote, handleCancel, handleSend, mode])

  if (isClosed) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('tickets.composer.closed', 'This ticket is closed. Reopen is not possible; a new email creates a new ticket.')}
      </p>
    )
  }

  if (!canReply && !canManage) return null

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4" onKeyDown={handleKeyDown} data-testid="ticket-composer">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          value={mode}
          onValueChange={(value) => setMode(value as ComposerMode)}
          aria-label={t('tickets.composer.mode', 'Composer mode')}
        >
          {canReply ? <SegmentedControlItem value="reply">{t('tickets.composer.modeReply', 'Reply')}</SegmentedControlItem> : null}
          {canManage ? <SegmentedControlItem value="note">{t('tickets.composer.modeNote', 'Internal note')}</SegmentedControlItem> : null}
        </SegmentedControl>
        {mode === 'reply' ? (
          <div className="min-w-56">
            <Select value={selectedDraftId} onValueChange={handleSelectDraft}>
              <SelectTrigger aria-label={t('tickets.composer.draftSelector', 'Draft')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_DRAFT_VALUE}>{t('tickets.composer.newDraft', 'New message')}</SelectItem>
                {drafts.map((draft, index) => (
                  <SelectItem key={draft.id} value={draft.id}>
                    {t('tickets.composer.draftOption', 'Draft {index} ({source})', {
                      index: drafts.length - index,
                      source: draft.sourceType ? t(`tickets.draft.source.${draft.sourceType}`, draft.sourceType) : t('tickets.draft.source.manual', 'manual'),
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      {mode === 'reply' ? (
        <div className="space-y-1">
          <Label htmlFor="ticket-composer-subject">{t('tickets.composer.subject', 'Subject (optional)')}</Label>
          <Input
            id="ticket-composer-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder={t('tickets.composer.subjectPlaceholder', 'Defaults to "Re: <ticket subject> [number]"')}
          />
        </div>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor="ticket-composer-body">
          {mode === 'reply' ? t('tickets.composer.body', 'Message') : t('tickets.composer.noteBody', 'Internal note')}
        </Label>
        <Textarea
          id="ticket-composer-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={8}
          placeholder={mode === 'reply'
            ? t('tickets.composer.bodyPlaceholder', 'Write a reply to the customer…')
            : t('tickets.composer.notePlaceholder', 'Visible to staff only…')}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <KbdShortcut keys={['⌘', 'Enter']} />
          <span>/</span>
          <KbdShortcut keys={['Ctrl', 'Enter']} />
          <span>{mode === 'reply' ? t('tickets.composer.shortcutSend', 'to send') : t('tickets.composer.shortcutNote', 'to add the note')}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'reply' ? (
            <>
              <CheckboxField
                id="ticket-composer-resolve"
                checked={resolveAfterSend}
                onCheckedChange={(checked) => setResolveAfterSend(checked === true)}
                label={t('tickets.composer.resolveAfterSend', 'Resolve after sending')}
              />
              <Button type="button" variant="outline" onClick={() => { void handleSaveDraft() }} disabled={busy !== null}>
                <Save className="size-4" aria-hidden />
                {t('tickets.composer.saveDraft', 'Save draft')}
              </Button>
              <Button type="button" onClick={() => { void handleSend() }} disabled={busy !== null}>
                <Send className="size-4" aria-hidden />
                {busy === 'send' ? t('tickets.composer.sending', 'Sending…') : t('tickets.composer.send', 'Send')}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => { void handleAddNote() }} disabled={busy !== null}>
              <StickyNote className="size-4" aria-hidden />
              {t('tickets.composer.addNote', 'Add note')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
