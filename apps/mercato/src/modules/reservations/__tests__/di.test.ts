const createReservationsService = jest.fn((em: unknown) => ({ em }))

jest.mock('../lib/reservationsService', () => ({
  createReservationsService: (em: unknown) => createReservationsService(em),
}))

import { asValue, createContainer, InjectionMode } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register, RESERVATIONS_SERVICE } from '../di'

describe('reservations DI registration', () => {
  it('injects the request EntityManager when resolved from a CLASSIC-mode container', () => {
    const em = { fork: jest.fn() }
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ em: asValue(em) })
    register(container as unknown as AppContainer)
    const service = container.createScope().resolve<{ em: unknown }>(RESERVATIONS_SERVICE)
    expect(service.em).toBe(em)
    expect(createReservationsService).toHaveBeenCalledWith(em)
  })
})
