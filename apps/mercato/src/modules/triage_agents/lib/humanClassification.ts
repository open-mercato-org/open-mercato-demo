import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { TICKET_ENTITY_TYPE } from '../data/constants'
import type { TriageScope } from './kbArticles'

const logger = createLogger('triage_agents').child({ component: 'humanClassification' })

type ResolverLike = { resolve: <T = unknown>(name: string) => T }

type Loose = Record<string, unknown>

export const MANUAL_CLASSIFICATION_SOURCE = 'manual'

export type TicketClassificationState = {
  source: string | null
  customerPersonId: string | null
  reservationId: string | null
  reservationNumberSnapshot: string | null
  categoryKey: string | null
  subcategoryKey: string | null
  topicKey: string | null
}

const TICKET_CLASSIFICATION_FIELDS = [
  'id',
  'classification_source',
  'customer_person_id',
  'reservation_id',
  'reservation_number_snapshot',
  'category_key',
  'subcategory_key',
  'topic_key',
]

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readField(row: Loose, snake: string, camel: string): string | null {
  return readString(row[snake]) ?? readString(row[camel])
}

export function toClassificationState(row: Loose): TicketClassificationState {
  return {
    source: readField(row, 'classification_source', 'classificationSource'),
    customerPersonId: readField(row, 'customer_person_id', 'customerPersonId'),
    reservationId: readField(row, 'reservation_id', 'reservationId'),
    reservationNumberSnapshot: readField(row, 'reservation_number_snapshot', 'reservationNumberSnapshot'),
    categoryKey: readField(row, 'category_key', 'categoryKey'),
    subcategoryKey: readField(row, 'subcategory_key', 'subcategoryKey'),
    topicKey: readField(row, 'topic_key', 'topicKey'),
  }
}

/**
 * Reads the ticket's current classification through the query engine (the ticket is
 * addressed by its entity id, no tickets import). Soft-optional: null when the
 * engine or the ticket is unavailable, so the workflow falls back to the AI values.
 */
export async function loadTicketClassification(
  container: ResolverLike,
  scope: TriageScope,
  ticketId: string | null | undefined,
): Promise<TicketClassificationState | null> {
  const id = readString(ticketId)
  if (!id) return null
  let queryEngine: QueryEngine
  try {
    queryEngine = container.resolve<QueryEngine>('queryEngine')
  } catch {
    return null
  }
  try {
    const result = await queryEngine.query<Loose>(TICKET_ENTITY_TYPE, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      fields: TICKET_CLASSIFICATION_FIELDS,
      filters: { id: { $eq: id } },
      page: { page: 1, pageSize: 1 },
    })
    const row = (result.items ?? []).find(isRecord)
    return row ? toClassificationState(row) : null
  } catch (err) {
    logger.warn('Ticket classification lookup unavailable', { error: err instanceof Error ? err.message : String(err) })
    reportError(err, { module: 'triage_agents', code: 'triage_agents.ticket_classification_lookup_failed' })
    return null
  }
}

export function isHumanClassified(state: TicketClassificationState | null): state is TicketClassificationState {
  return state?.source === MANUAL_CLASSIFICATION_SOURCE
}

export type EffectiveTriageInput = {
  identification: Loose | null
  classification: Loose | null
}

/**
 * A consultant classified the ticket by hand: the workflow keeps that classification
 * (the classify command refuses to overwrite it) and routes with the human values.
 * Human-set fields replace the AI ones; the AI's uncertainty about what the human
 * settled is dropped, and the classification is marked `source: 'manual'`.
 */
export function applyHumanClassification(
  identification: Loose | null,
  classification: Loose | null,
  state: TicketClassificationState,
): EffectiveTriageInput {
  const aiClassification = classification ?? {}
  const topicKey = state.topicKey ?? readString(aiClassification.topicKey)
  const topicChanged = topicKey !== readString(aiClassification.topicKey)
  const nextClassification: Loose = {
    ...aiClassification,
    categoryKey: state.categoryKey ?? readString(aiClassification.categoryKey),
    subcategoryKey: state.subcategoryKey ?? readString(aiClassification.subcategoryKey),
    topicKey,
    topicVersion: topicChanged ? null : aiClassification.topicVersion ?? null,
    confidence: 1,
    uncertainty: [],
    source: MANUAL_CLASSIFICATION_SOURCE,
  }

  if (!identification) return { identification: null, classification: nextClassification }
  const nextIdentification: Loose = { ...identification }
  const customer = isRecord(identification.customer) ? identification.customer : {}
  if (state.customerPersonId) {
    nextIdentification.customer = { ...customer, personId: state.customerPersonId, match: 'confirmed' }
  }
  const reservation = isRecord(identification.reservation) ? identification.reservation : {}
  if (state.reservationId) {
    const sameReservation = readString(reservation.reservationId) === state.reservationId
    nextIdentification.reservation = {
      ...reservation,
      reservationId: state.reservationId,
      bookingNumber: state.reservationNumberSnapshot ?? (sameReservation ? readString(reservation.bookingNumber) : null),
      match: 'explicit_number_verified',
      candidates: [],
      departureDate: sameReservation ? reservation.departureDate ?? null : null,
      daysToDeparture: sameReservation ? reservation.daysToDeparture ?? null : null,
    }
    nextIdentification.uncertainty = []
  }
  return { identification: nextIdentification, classification: nextClassification }
}
