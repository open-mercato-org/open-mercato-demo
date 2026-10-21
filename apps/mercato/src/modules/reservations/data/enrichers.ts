import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { ticketReservationEnricher } from '../lib/ticketReservationEnricher'

export const enrichers: ResponseEnricher[] = [ticketReservationEnricher]

export default enrichers
