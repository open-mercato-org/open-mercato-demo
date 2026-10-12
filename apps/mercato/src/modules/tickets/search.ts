import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultLink,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const TICKET_ENTITY_ID = 'tickets:ticket'

function readString(record: Record<string, unknown>, snakeKey: string, camelKey?: string): string | null {
  const value = record[snakeKey] ?? (camelKey ? record[camelKey] : undefined)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function appendLine(lines: string[], label: string, value: string | null): void {
  if (!value) return
  lines.push(`${label}: ${value}`)
}

function buildTicketUrl(record: Record<string, unknown>): string | null {
  const id = readString(record, 'id', 'id')
  return id ? `/backend/tickets/${id}` : null
}

function resolvePresenter(record: Record<string, unknown>): SearchResultPresenter {
  const number = readString(record, 'number', 'number') ?? 'Ticket'
  const categoryPath = readString(record, 'category_path_snapshot', 'categoryPathSnapshot')
  const reservationNumber = readString(record, 'reservation_number_snapshot', 'reservationNumberSnapshot')
  const subtitle = [categoryPath, reservationNumber].filter((value): value is string => Boolean(value)).join(' — ')
  return {
    title: number,
    subtitle: subtitle || undefined,
    icon: 'life-buoy',
    badge: readString(record, 'status', 'status') ?? undefined,
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: TICKET_ENTITY_ID,
      enabled: true,
      priority: 15,
      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Ticket number', readString(record, 'number', 'number'))
        appendLine(lines, 'Category', readString(record, 'category_path_snapshot', 'categoryPathSnapshot'))
        appendLine(lines, 'Reservation', readString(record, 'reservation_number_snapshot', 'reservationNumberSnapshot'))
        if (!lines.length) return null
        const presenter = resolvePresenter(record)
        const url = buildTicketUrl(record)
        const links: SearchResultLink[] = url ? [{ href: url, label: presenter.title, kind: 'primary' }] : []
        return {
          text: lines,
          presenter,
          links,
          checksumSource: {
            number: readString(record, 'number', 'number'),
            category: readString(record, 'category_path_snapshot', 'categoryPathSnapshot'),
            reservation: readString(record, 'reservation_number_snapshot', 'reservationNumberSnapshot'),
            status: readString(record, 'status', 'status'),
          },
        }
      },
      formatResult: (ctx: SearchBuildContext): SearchResultPresenter | null => resolvePresenter(ctx.record),
      resolveUrl: (ctx: SearchBuildContext): string | null => buildTicketUrl(ctx.record),
      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        const url = buildTicketUrl(ctx.record)
        if (!url) return null
        const { t } = await resolveTranslations()
        return [{ href: url, label: t('tickets.search.openTicket', 'Open ticket'), kind: 'secondary' }]
      },
      fieldPolicy: {
        searchable: ['number', 'category_path_snapshot', 'reservation_number_snapshot'],
        hashOnly: ['customer_person_id', 'reservation_id'],
        excluded: [
          'tenant_id',
          'organization_id',
          'subject',
          'summary',
          'requester_email',
          'requester_email_hash',
          'requester_name',
          'manual_review_reason',
          'assignee_user_id',
          'deleted_at',
        ],
      },
      aclFeatures: ['tickets.view'],
    },
  ],
}

export default searchConfig
