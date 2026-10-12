const findOneWithDecryption = jest.fn()
const findWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))
jest.mock('../events', () => ({ emitReservationsEvent: jest.fn(async () => undefined) }))

import '../commands/refunds'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ReservationPayment, ReservationRefund } from '../data/entities'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const reservationId = '33333333-3333-4333-8333-333333333333'

type Persisted = Record<string, unknown>

function getCommand(id: string): CommandHandler<Record<string, unknown>, Record<string, unknown>> {
  const handler = commandRegistry.get(id)
  if (!handler) throw new Error(`Command ${id} not registered`)
  return handler as CommandHandler<Record<string, unknown>, Record<string, unknown>>
}

function createContext(): { ctx: CommandRuntimeContext; persisted: Persisted[] } {
  const persisted: Persisted[] = []
  const em = {
    fork: () => em,
    transactional: async <T,>(fn: (tem: unknown) => Promise<T>) => fn(em),
    create: (_entity: unknown, data: Persisted) => ({ id: '55555555-5555-4555-8555-555555555555', ...data }),
    persist: (entity: Persisted) => {
      persisted.push(entity)
      return em
    },
    flush: async () => undefined,
  }
  const dataEngine = {
    markOrmEntityChange: jest.fn(),
    emitOrmEntityEvent: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  }
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'dataEngine') return dataEngine
      throw new Error(`unregistered ${name}`)
    },
    hasRegistration: () => false,
  }
  const ctx = {
    container,
    auth: { sub: '66666666-6666-4666-8666-666666666666', tenantId, orgId: organizationId },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  } as unknown as CommandRuntimeContext
  return { ctx, persisted }
}

function mockBalance(payments: Array<{ amount: string; status: string }>, refunds: Array<{ amount: string; status: string }>) {
  findOneWithDecryption.mockResolvedValue({
    id: reservationId,
    tenantId,
    organizationId,
    totalPriceAmount: '2400.00',
    currencyCode: 'EUR',
    departureDate: '2026-10-15',
  })
  findWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === ReservationPayment) return payments
    if (entity === ReservationRefund) return refunds
    return []
  })
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('expected the command to throw')
}

describe('reservations.refund.request', () => {
  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('creates a requested refund when the amount fits the overpayment', async () => {
    mockBalance([{ amount: '2000.00', status: 'booked' }, { amount: '750.00', status: 'booked' }], [])
    const { ctx, persisted } = createContext()
    const result = await getCommand('reservations.refund.request').execute(
      { reservationId, amount: 350, bankAccountNumber: 'DE89 3704 0044 0532 0130 00', reason: 'Overpayment' },
      ctx,
    )
    expect(result).toMatchObject({ reservationId, amount: '350.00', currencyCode: 'EUR', status: 'requested' })
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      bankAccountNumber: 'DE89370400440532013000',
      bankAccountLast4: '3000',
      status: 'requested',
      requestedByUserId: '66666666-6666-4666-8666-666666666666',
    })
  })

  it('rejects a refund above the overpayment with 422 refund_exceeds_overpayment', async () => {
    mockBalance([{ amount: '2750.00', status: 'booked' }], [])
    const { ctx, persisted } = createContext()
    const error = await captureError(() =>
      getCommand('reservations.refund.request').execute(
        { reservationId, amount: 350.01, bankAccountNumber: 'DE89370400440532013000' },
        ctx,
      ),
    )
    expect(isCrudHttpError(error)).toBe(true)
    if (!isCrudHttpError(error)) return
    expect(error.status).toBe(422)
    expect(error.body).toMatchObject({ code: 'refund_exceeds_overpayment', overpayment: 350 })
    expect(persisted).toHaveLength(0)
  })

  it('counts already requested refunds against the overpayment', async () => {
    mockBalance([{ amount: '2750.00', status: 'booked' }], [{ amount: '300.00', status: 'requested' }])
    const { ctx } = createContext()
    const error = await captureError(() =>
      getCommand('reservations.refund.request').execute(
        { reservationId, amount: 100, bankAccountNumber: 'DE89370400440532013000' },
        ctx,
      ),
    )
    expect(isCrudHttpError(error) && error.status).toBe(422)
  })

  it('rejects an invalid IBAN with 422 invalid_iban before touching the reservation', async () => {
    const { ctx } = createContext()
    const error = await captureError(() =>
      getCommand('reservations.refund.request').execute(
        { reservationId, amount: 10, bankAccountNumber: 'DE88 3704 0044 0532 0130 00' },
        ctx,
      ),
    )
    expect(isCrudHttpError(error)).toBe(true)
    if (!isCrudHttpError(error)) return
    expect(error.status).toBe(422)
    expect(error.body).toMatchObject({ code: 'invalid_iban' })
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })
})
