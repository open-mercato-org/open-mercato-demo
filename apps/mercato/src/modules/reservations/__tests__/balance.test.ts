import {
  checkRefundWithinOverpayment,
  computeBalanceCents,
  computeReservationBalance,
  formatAmount,
} from '../lib/balance'

const reservation = { totalPriceAmount: '2400.00', currencyCode: 'EUR', departureDate: '2026-10-15' }

describe('computeReservationBalance', () => {
  it('derives the ABC123 overpayment from booked payments only', () => {
    const balance = computeReservationBalance(
      reservation,
      [
        { amount: '2000.00', status: 'booked' },
        { amount: '750.00', status: 'booked' },
        { amount: '100.00', status: 'pending' },
        { amount: '999.00', status: 'failed' },
      ],
      [],
      { now: new Date('2026-10-12T10:00:00Z'), timeZone: 'UTC' },
    )
    expect(balance).toEqual({
      totalPrice: 2400,
      paidTotal: 2750,
      pendingPaymentsTotal: 100,
      refundedTotal: 0,
      outstanding: 0,
      overpayment: 350,
      currencyCode: 'EUR',
      daysToDeparture: 3,
    })
  })

  it('reports an outstanding amount for partial payments', () => {
    const balance = computeReservationBalance(reservation, [{ amount: 500, status: 'booked' }], [], {
      now: new Date('2026-10-12T10:00:00Z'),
      timeZone: 'UTC',
    })
    expect(balance.outstanding).toBe(1900)
    expect(balance.overpayment).toBe(0)
  })

  it('counts requested, approved and executed refunds but not rejected or cancelled ones', () => {
    const cents = computeBalanceCents(
      reservation,
      [{ amount: '2750.00', status: 'booked' }],
      [
        { amount: '100.00', status: 'requested' },
        { amount: '50.00', status: 'approved' },
        { amount: '25.00', status: 'executed' },
        { amount: '300.00', status: 'rejected' },
        { amount: '300.00', status: 'cancelled' },
      ],
    )
    expect(cents.refunded).toBe(17500)
    expect(cents.overpayment).toBe(17500)
  })

  it('never reports a negative overpayment or outstanding amount', () => {
    const cents = computeBalanceCents(reservation, [{ amount: '2400.00', status: 'booked' }], [{ amount: '400.00', status: 'executed' }])
    expect(cents.overpayment).toBe(0)
    expect(cents.outstanding).toBe(40000)
  })

  it('avoids floating point drift on cents', () => {
    const cents = computeBalanceCents({ totalPriceAmount: '0.30' }, [{ amount: '0.10', status: 'booked' }, { amount: '0.20', status: 'booked' }, { amount: '0.01', status: 'booked' }], [])
    expect(cents.overpayment).toBe(1)
    expect(formatAmount('0.1')).toBe('0.10')
  })
})

describe('checkRefundWithinOverpayment', () => {
  it('accepts an amount equal to the overpayment', () => {
    expect(checkRefundWithinOverpayment(350, 35000)).toEqual({ ok: true })
  })

  it('rejects an amount above the overpayment', () => {
    expect(checkRefundWithinOverpayment('350.01', 35000)).toEqual({ ok: false, overpayment: 350 })
  })

  it('rejects zero, negative and refunds without any overpayment', () => {
    expect(checkRefundWithinOverpayment(0, 35000).ok).toBe(false)
    expect(checkRefundWithinOverpayment(-5, 35000).ok).toBe(false)
    expect(checkRefundWithinOverpayment(10, 0).ok).toBe(false)
  })
})
