import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { RESERVATION_ENTITY_ID } from './data/constants'
import { toDateOnlyString } from './lib/dates'

function pickString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function appendLine(lines: string[], label: string, value: unknown) {
  const text = pickString(value)
  if (text) lines.push(`${label}: ${text}`)
}

function buildPresenter(t: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const bookingNumber = pickString(record.booking_number) ?? String(record.id ?? '')
  const destination = pickString(record.destination)
  const hotelName = pickString(record.hotel_name)
  const departure = toDateOnlyString(record.departure_date)
  const subtitle = [hotelName, destination, departure].filter((value): value is string => Boolean(value)).join(' · ')
  const status = pickString(record.status)
  return {
    title: bookingNumber,
    subtitle: subtitle || undefined,
    icon: 'plane',
    badge: status ? t(`reservations.status.${status}`, status) : t('reservations.search.badge', 'Reservation'),
  }
}

function buildSource(ctx: SearchBuildContext, presenter: SearchResultPresenter): SearchIndexSource | null {
  const lines: string[] = []
  appendLine(lines, 'Booking number', ctx.record.booking_number)
  appendLine(lines, 'Destination', ctx.record.destination)
  appendLine(lines, 'Hotel', ctx.record.hotel_name)
  if (!lines.length) return null
  return {
    text: lines,
    presenter,
    checksumSource: {
      booking_number: ctx.record.booking_number ?? null,
      destination: ctx.record.destination ?? null,
      hotel_name: ctx.record.hotel_name ?? null,
      status: ctx.record.status ?? null,
      departure_date: ctx.record.departure_date ?? null,
    },
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: RESERVATION_ENTITY_ID,
      enabled: true,
      priority: 6,
      aclFeatures: ['reservations.view'],
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildSource(ctx, buildPresenter(t, ctx.record))
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildPresenter(t, ctx.record)
      },
      resolveUrl: (ctx) => `/backend/reservations/${encodeURIComponent(String(ctx.record.id))}`,
      fieldPolicy: {
        searchable: ['booking_number', 'destination', 'hotel_name', 'customer_name_snapshot'],
        excluded: ['customer_email_snapshot', 'customer_email_hash', 'notes'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
