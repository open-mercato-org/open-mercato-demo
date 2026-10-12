import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { RESERVATIONS_SERVICE } from './di'
import { loadCustomerPersonContact } from './lib/customerLookup'
import type { ReservationsService, ReservationsScope } from './lib/reservationsService'
import {
  findByBookingNumberInputSchema,
  findReservationByBookingNumber,
  getDetailsInputSchema,
  getReservationDetails,
  listForCustomerInputSchema,
  listReservationsForCustomer,
  type FindByBookingNumberResult,
  type GetDetailsResult,
  type ListForCustomerResult,
  type ReservationsToolDeps,
} from './lib/aiToolHandlers'

export function requireToolScope(context: Pick<McpToolContext, 'tenantId' | 'organizationId'>): ReservationsScope {
  const tenantId = typeof context.tenantId === 'string' ? context.tenantId.trim() : ''
  const organizationId = typeof context.organizationId === 'string' ? context.organizationId.trim() : ''
  if (!tenantId || !organizationId) {
    throw new Error('[internal] reservations AI tools require a tenant- and organization-scoped context')
  }
  return { tenantId, organizationId }
}

function buildDeps(context: McpToolContext): ReservationsToolDeps {
  const service = context.container.resolve<ReservationsService>(RESERVATIONS_SERVICE)
  return {
    findByBookingNumber: service.findByBookingNumber,
    listForCustomerPerson: service.listForCustomerPerson,
    listForEmail: service.listForEmail,
    getDetails: (scope, reservationId) => service.getDetails(scope, reservationId),
    loadPersonContact: (scope, personId) => loadCustomerPersonContact(context.container, scope, personId),
  }
}

const findByBookingNumberTool: AiToolDefinition = defineAiTool<unknown, FindByBookingNumberResult>({
  name: 'reservations.find_by_booking_number',
  displayName: 'Reservations — find by booking number',
  description:
    'Look up a reservation by its booking number (free-text forms such as "abc-123" are normalized). When senderEmail is given, ownerMatch tells whether it matches the customer email stored at booking time or the customer\'s current email. On a mismatch the reservation details are withheld. Read-only.',
  tags: ['read', 'reservations'],
  isMutation: false,
  requiredFeatures: ['reservations.view'],
  inputSchema: findByBookingNumberInputSchema,
  async handler(input, context) {
    return findReservationByBookingNumber(buildDeps(context), requireToolScope(context), input)
  },
})

const listForCustomerTool: AiToolDefinition = defineAiTool<unknown, ListForCustomerResult>({
  name: 'reservations.list_for_customer',
  displayName: 'Reservations — list for customer',
  description:
    'List up to 20 reservations of one customer, by customers person id or by email (matched against the email stored at booking time). Returns booking number, destination, hotel, dates, status and days to departure. Read-only.',
  tags: ['read', 'reservations', 'customers'],
  isMutation: false,
  requiredFeatures: ['reservations.view'],
  inputSchema: listForCustomerInputSchema,
  async handler(input, context) {
    return listReservationsForCustomer(buildDeps(context), requireToolScope(context), input)
  },
})

const getDetailsTool: AiToolDefinition = defineAiTool<unknown, GetDetailsResult>({
  name: 'reservations.get_details',
  displayName: 'Reservations — details with balance',
  description:
    'Return one reservation with its payments, refund requests (bank account masked to the last 4 digits) and the computed balance: total price, booked payments, pending payments, refunds, outstanding amount, overpayment and days to departure. Read-only.',
  tags: ['read', 'reservations'],
  isMutation: false,
  requiredFeatures: ['reservations.view'],
  inputSchema: getDetailsInputSchema,
  async handler(input, context) {
    return getReservationDetails(buildDeps(context), requireToolScope(context), input)
  },
})

export const aiTools: AiToolDefinition[] = [findByBookingNumberTool, listForCustomerTool, getDetailsTool]

export default aiTools
