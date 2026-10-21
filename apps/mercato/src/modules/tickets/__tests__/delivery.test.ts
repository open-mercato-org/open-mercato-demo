/** @jest-environment node */
import { deliverTicketReply, resolveConfiguredDeliveryMode } from '../lib/delivery'

const message = {
  to: 'customer@example.com',
  subject: 'Re: Refund [TCK-000001]',
  text: 'Hello',
  tenantId: 't-1',
  organizationId: 'o-1',
}

const fixedNow = new Date('2026-10-12T10:00:00.000Z')

describe('ticket reply delivery', () => {
  it('reads the simulated mode from env', () => {
    expect(resolveConfiguredDeliveryMode({ OM_TICKETS_DELIVERY: 'simulated' })).toBe('simulated')
    expect(resolveConfiguredDeliveryMode({ OM_TICKETS_DELIVERY: 'SIMULATED ' })).toBe('simulated')
    expect(resolveConfiguredDeliveryMode({})).toBe('live')
  })

  it('records simulated delivery when the env forces it', async () => {
    const send = jest.fn()
    const result = await deliverTicketReply(message, {
      env: { OM_TICKETS_DELIVERY: 'simulated' },
      send,
      isDisabled: () => false,
      isConfigured: () => true,
      now: () => fixedNow,
    })
    expect(result).toEqual({ status: 'simulated', sentAt: fixedNow, reason: 'simulated_mode' })
    expect(send).not.toHaveBeenCalled()
  })

  it('falls back to simulated when delivery is disabled', async () => {
    const send = jest.fn()
    const result = await deliverTicketReply(message, { env: {}, send, isDisabled: () => true, isConfigured: () => true, now: () => fixedNow })
    expect(result.status).toBe('simulated')
    expect(result.reason).toBe('delivery_disabled')
    expect(send).not.toHaveBeenCalled()
  })

  it('falls back to simulated when no transport is configured', async () => {
    const send = jest.fn()
    const result = await deliverTicketReply(message, { env: {}, send, isDisabled: () => false, isConfigured: () => false, now: () => fixedNow })
    expect(result.status).toBe('simulated')
    expect(result.reason).toBe('not_configured')
    expect(send).not.toHaveBeenCalled()
  })

  it('sends through the transport when configured', async () => {
    const send = jest.fn(async () => undefined)
    const result = await deliverTicketReply(message, { env: {}, send, isDisabled: () => false, isConfigured: () => true, now: () => fixedNow })
    expect(result).toEqual({ status: 'sent', sentAt: fixedNow, reason: 'sent' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: message.to, subject: message.subject, text: 'Hello', tenantId: 't-1' }))
  })

  it('reports failure without throwing when the transport errors', async () => {
    const send = jest.fn(async () => { throw new Error('smtp down') })
    const result = await deliverTicketReply(message, { env: {}, send, isDisabled: () => false, isConfigured: () => true, now: () => fixedNow })
    expect(result).toEqual({ status: 'failed', sentAt: null, reason: 'transport_error' })
  })
})
