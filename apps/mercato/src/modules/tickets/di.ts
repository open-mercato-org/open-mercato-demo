import { asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { TicketNumberGenerator } from './lib/numberGenerator'

export const TICKET_NUMBER_GENERATOR = 'ticketNumberGenerator' as const

type TicketsCradle = AppContainer['cradle'] & {
  em: EntityManager
}

export function register(container: AppContainer) {
  container.register({
    [TICKET_NUMBER_GENERATOR]: asFunction(({ em }: TicketsCradle) => new TicketNumberGenerator(em))
      .singleton()
      .proxy(),
  })
}
