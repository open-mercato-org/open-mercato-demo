"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Trash2, UserCheck, UserMinus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import type { ActionItem } from '@open-mercato/ui/backend/forms/ActionsDropdown'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { InjectionSpot, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { TICKET_STATUS_TRANSITIONS, type TicketStatus } from '../../../data/constants'
import extensionPoints from '../../../extension-points'
import { ManualReviewIndicator, PriorityBadge, TicketStatusBadge, useStatusLabel } from '../../../components/TicketBadges'
import { TicketThread } from '../../../components/detail/TicketThread'
import { TicketComposer } from '../../../components/detail/TicketComposer'
import { ClassificationPanel } from '../../../components/detail/ClassificationPanel'
import { ClassifyDialog } from '../../../components/detail/ClassifyDialog'
import { FlagReviewDialog } from '../../../components/detail/FlagReviewDialog'
import { useTicketAccess } from '../../../components/detail/useTicketAccess'
import { usePeopleLabels } from '../../../components/usePeopleLabels'
import { useTicketDelete } from '../../../components/useTicketDelete'
import {
  TICKET_LIST_PATH,
  ticketApiPath,
  type TicketArticleRow,
  type TicketDraftRow,
  type TicketQueueOption,
  type TicketRow,
} from '../../../components/ticketTypes'

type ListResponse<T> = { items?: T[] }

type TicketDetailInjectionContext = {
  formId: string
  resourceKind: 'tickets.ticket'
  resourceId: string
  ticket: TicketRow | null
  drafts: TicketDraftRow[]
  reload: () => Promise<void>
  reloadDrafts: () => Promise<void>
  retryLastMutation: () => Promise<boolean>
}

function jsonInit(body: Record<string, unknown>, method = 'POST'): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

async function loadList<T>(path: string): Promise<T[]> {
  const response = await apiCall<ListResponse<T>>(path)
  if (!response.ok) throw new Error(`[internal] failed to load ${path}`)
  return Array.isArray(response.result?.items) ? response.result.items : []
}

export default function TicketDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id ?? ''
  const t = useT()
  const router = useRouter()
  const statusLabel = useStatusLabel()
  const access = useTicketAccess()
  const [classifyOpen, setClassifyOpen] = React.useState(false)
  const [flagOpen, setFlagOpen] = React.useState(false)
  const formId = `tickets-ticket-${id}`
  const { runMutation, retryLastMutation } = useGuardedMutation<TicketDetailInjectionContext>({ contextId: formId })
  const { deleteTicket, ConfirmDialogElement } = useTicketDelete(`${formId}-delete`)

  const ticketQuery = useQuery<TicketRow | null>({
    queryKey: ['tickets', 'detail', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const response = await fetchCrudList<TicketRow>('tickets/tickets', { id, page: 1, pageSize: 1 })
      return response.items?.[0] ?? null
    },
  })
  const articlesQuery = useQuery<TicketArticleRow[]>({
    queryKey: ['tickets', 'articles', id],
    enabled: Boolean(id),
    queryFn: () => loadList<TicketArticleRow>(ticketApiPath(id, 'articles')),
  })
  const draftsQuery = useQuery<TicketDraftRow[]>({
    queryKey: ['tickets', 'drafts', id],
    enabled: Boolean(id),
    queryFn: () => loadList<TicketDraftRow>(ticketApiPath(id, 'drafts')),
  })
  const queuesQuery = useQuery<TicketQueueOption[]>({
    queryKey: ['tickets', 'queues'],
    queryFn: () => loadList<TicketQueueOption>('/api/tickets/queues'),
  })

  const ticket = ticketQuery.data ?? null
  const drafts = React.useMemo(() => draftsQuery.data ?? [], [draftsQuery.data])
  const articles = React.useMemo(() => articlesQuery.data ?? [], [articlesQuery.data])
  const queues = React.useMemo(() => queuesQuery.data ?? [], [queuesQuery.data])
  const personLabels = usePeopleLabels([ticket?.customerPersonId])

  const { refetch: refetchTicket } = ticketQuery
  const { refetch: refetchArticles } = articlesQuery
  const { refetch: refetchDrafts } = draftsQuery

  const reloadDrafts = React.useCallback(async () => {
    await refetchDrafts()
  }, [refetchDrafts])

  const reload = React.useCallback(async () => {
    await Promise.all([refetchTicket(), refetchArticles(), refetchDrafts()])
  }, [refetchArticles, refetchDrafts, refetchTicket])

  const handleAppEvent = React.useCallback((event: { payload?: unknown }) => {
    const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {}
    if (payload.ticketId === id || payload.id === id) void reload()
  }, [id, reload])
  useAppEvent('tickets.article.received', handleAppEvent, [handleAppEvent])
  useAppEvent('tickets.reply.sent', handleAppEvent, [handleAppEvent])
  useAppEvent('tickets.ticket.updated', handleAppEvent, [handleAppEvent])

  const injectionContext = React.useMemo<TicketDetailInjectionContext>(() => ({
    formId,
    resourceKind: 'tickets.ticket',
    resourceId: id,
    ticket,
    drafts,
    reload,
    reloadDrafts,
    retryLastMutation,
  }), [drafts, formId, id, reload, reloadDrafts, retryLastMutation, ticket])

  const runTicketMutation = React.useCallback(async (
    suffix: string | null,
    body: Record<string, unknown>,
    method = 'POST',
  ) => {
    if (!ticket) return
    const path = suffix ? ticketApiPath(ticket.id, suffix) : '/api/tickets/tickets'
    await runMutation({
      operation: () => withScopedApiRequestHeaders(
        buildOptimisticLockHeader(ticket.updatedAt),
        () => apiCallOrThrow(path, jsonInit(body, method)),
      ),
      context: injectionContext,
      mutationPayload: body,
    })
    await reload()
  }, [injectionContext, reload, runMutation, ticket])

  const handleTransition = React.useCallback(async (to: TicketStatus) => {
    try {
      await runTicketMutation('transition', { to })
      flash(t('tickets.detail.flash.transitioned', 'Status changed to {status}.', { status: statusLabel(to) }), 'success')
    } catch (err) {
      flash(err instanceof Error && err.message ? err.message : t('tickets.detail.errors.transition', 'Failed to change the status.'), 'error')
    }
  }, [runTicketMutation, statusLabel, t])

  const handleAssign = React.useCallback(async (assigneeUserId: string | null) => {
    if (!ticket) return
    try {
      await runTicketMutation(null, { id: ticket.id, assigneeUserId }, 'PUT')
      flash(
        assigneeUserId
          ? t('tickets.detail.flash.assigned', 'Ticket assigned to you.')
          : t('tickets.detail.flash.unassigned', 'Ticket unassigned.'),
        'success',
      )
    } catch (err) {
      flash(err instanceof Error && err.message ? err.message : t('tickets.detail.errors.assign', 'Failed to update the assignee.'), 'error')
    }
  }, [runTicketMutation, t, ticket])

  const handleClearFlag = React.useCallback(async () => {
    try {
      await runTicketMutation('flag-manual-review', { clear: true })
      flash(t('tickets.manualReview.flash.cleared', 'Manual review flag cleared.'), 'success')
    } catch (err) {
      flash(err instanceof Error && err.message ? err.message : t('tickets.manualReview.errors.clear', 'Failed to clear the flag.'), 'error')
    }
  }, [runTicketMutation, t])

  const runComposerMutation = React.useCallback(
    <TResult,>(operation: () => Promise<TResult>, payload?: Record<string, unknown>) => runMutation({
      operation,
      context: injectionContext,
      mutationPayload: payload ?? {},
    }),
    [injectionContext, runMutation],
  )

  const { widgets: tabWidgets } = useInjectionWidgets(extensionPoints.hosts.ticketTabs.spotId, {
    context: injectionContext,
    triggerOnLoad: true,
  })

  const handleDelete = React.useCallback(async () => {
    if (!ticket) return
    const deleted = await deleteTicket(ticket)
    if (deleted) router.push(TICKET_LIST_PATH)
  }, [deleteTicket, router, ticket])

  const menuActions = React.useMemo<ActionItem[]>(() => {
    if (!ticket?.status) return []
    const items: ActionItem[] = []
    if (access.canManage) {
      for (const next of TICKET_STATUS_TRANSITIONS[ticket.status] ?? []) {
        items.push({
          id: `transition-${next}`,
          label: t('tickets.detail.actions.transitionTo', 'Move to {status}', { status: statusLabel(next) }),
          icon: ArrowRight,
          onSelect: () => { void handleTransition(next) },
        })
      }
      if (access.userId && ticket.assigneeUserId !== access.userId) {
        items.push({
          id: 'assign-me',
          label: t('tickets.detail.actions.assignToMe', 'Assign to me'),
          icon: UserCheck,
          onSelect: () => { void handleAssign(access.userId) },
        })
      }
      if (ticket.assigneeUserId) {
        items.push({
          id: 'unassign',
          label: t('tickets.detail.actions.unassign', 'Unassign'),
          icon: UserMinus,
          onSelect: () => { void handleAssign(null) },
        })
      }
      items.push({
        id: 'delete',
        label: t('tickets.delete.action', 'Delete ticket'),
        icon: Trash2,
        onSelect: () => { void handleDelete() },
      })
    }
    return items
  }, [access.canManage, access.userId, handleAssign, handleDelete, handleTransition, statusLabel, t, ticket])

  if (!id || ticketQuery.isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('tickets.detail.loading', 'Loading ticket…')} />
        </PageBody>
      </Page>
    )
  }

  if (ticketQuery.isError) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={t('tickets.detail.error', 'Failed to load the ticket.')} />
        </PageBody>
      </Page>
    )
  }

  if (!ticket) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('tickets.detail.notFound', 'Ticket not found')}
            backHref={TICKET_LIST_PATH}
            backLabel={t('tickets.detail.backToQueue', 'Back to tickets')}
          />
        </PageBody>
      </Page>
    )
  }

  const queueLabel = queues.find((queue) => queue.value === ticket.queueKey)?.label ?? ticket.queueKey

  return (
    <Page>
      <PageBody>
        <div className="space-y-4">
          <FormHeader
            mode="detail"
            backHref={TICKET_LIST_PATH}
            backLabel={t('tickets.detail.backToQueue', 'Back to tickets')}
            entityTypeLabel={t('tickets.detail.entityType', 'Ticket')}
            title={`${ticket.number ?? ''} · ${ticket.subject ?? ''}`}
            subtitle={[ticket.requesterName, ticket.requesterEmail].filter(Boolean).join(' · ')}
            statusBadge={(
              <div className="flex flex-wrap items-center gap-2">
                <TicketStatusBadge status={ticket.status} />
                <PriorityBadge priority={ticket.priority} reason={ticket.priorityReason} />
                <ManualReviewIndicator
                  needsManualReview={ticket.needsManualReview}
                  reason={ticket.manualReviewReason}
                  reasonCode={ticket.manualReviewReasonCode}
                />
              </div>
            )}
            menuActions={menuActions}
            menuLabel={t('tickets.detail.actions.label', 'Actions')}
          />
          <InjectionSpot spotId={extensionPoints.hosts.ticketHeader.spotId} context={injectionContext} data={ticket} />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <section className="space-y-3" aria-labelledby="ticket-thread-heading">
                <h2 id="ticket-thread-heading" className="text-sm font-semibold">
                  {t('tickets.thread.title', 'Conversation')}
                </h2>
                {articlesQuery.isLoading ? (
                  <LoadingMessage label={t('tickets.thread.loading', 'Loading messages…')} />
                ) : articlesQuery.isError ? (
                  <ErrorMessage label={t('tickets.thread.error', 'Failed to load messages.')} />
                ) : (
                  <TicketThread articles={articles} />
                )}
              </section>
              <InjectionSpot spotId={extensionPoints.hosts.ticketComposer.spotId} context={injectionContext} data={{ ticket, drafts, reloadDrafts }} />
              <TicketComposer
                ticket={ticket}
                drafts={drafts}
                canReply={access.canReply}
                canManage={access.canManage}
                runMutation={runComposerMutation}
                onChanged={reload}
              />
              {tabWidgets.map((widget) => (
                <section key={widget.widgetId} className="space-y-2">
                  <h2 className="text-sm font-semibold">
                    {widget.placement?.groupLabel
                      ? t(widget.placement.groupLabel, widget.placement.groupLabel)
                      : widget.module.metadata.title ?? widget.widgetId}
                  </h2>
                  <widget.module.Widget context={injectionContext} data={ticket} />
                </section>
              ))}
            </div>
            <aside className="space-y-4">
              <ClassificationPanel
                ticket={ticket}
                personLabel={ticket.customerPersonId ? personLabels[ticket.customerPersonId] ?? null : null}
                canClassify={access.canClassify}
                onClassify={() => setClassifyOpen(true)}
                onFlag={() => setFlagOpen(true)}
                onClearFlag={() => { void handleClearFlag() }}
              />
              <section className="space-y-2 rounded-md border border-border bg-card p-4 text-sm" aria-labelledby="ticket-details-heading">
                <h2 id="ticket-details-heading" className="text-sm font-semibold">{t('tickets.detail.details', 'Details')}</h2>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{t('tickets.detail.queue', 'Queue')}</span>
                  <span>{queueLabel}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{t('tickets.detail.channel', 'Channel')}</span>
                  <span>{ticket.channel ? t(`tickets.channel.${ticket.channel}`, ticket.channel) : '—'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{t('tickets.detail.assignee', 'Assignee')}</span>
                  <span>
                    {ticket.assigneeUserId
                      ? ticket.assigneeUserId === access.userId
                        ? t('tickets.detail.assigneeMe', 'You')
                        : ticket.assigneeUserId
                      : t('tickets.detail.unassigned', 'Unassigned')}
                  </span>
                </div>
              </section>
              <InjectionSpot spotId={extensionPoints.hosts.ticketSidebar.spotId} context={injectionContext} data={ticket} />
            </aside>
          </div>
        </div>
        {classifyOpen ? (
          <ClassifyDialog open={classifyOpen} ticket={ticket} onClose={() => setClassifyOpen(false)} onSaved={reload} />
        ) : null}
        {flagOpen ? (
          <FlagReviewDialog open={flagOpen} ticket={ticket} queues={queues} onClose={() => setFlagOpen(false)} onSaved={reload} />
        ) : null}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
