import { asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createReservationsService } from './lib/reservationsService'

export const RESERVATIONS_SERVICE = 'reservationsService' as const

export function register(container: AppContainer) {
  container.register({
    [RESERVATIONS_SERVICE]: asFunction(({ em }: { em: EntityManager }) => createReservationsService(em)).scoped().proxy(),
  })
}
