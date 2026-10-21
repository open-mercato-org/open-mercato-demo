import { extractStepToolCalls } from '../lib/runtime/nativeTraceCapture'

describe('extractStepToolCalls', () => {
  it('reads AI SDK 7 input from toolCalls and output from toolResults by toolCallId', () => {
    const records = extractStepToolCalls({
      toolCalls: [
        { toolCallId: 'call-1', toolName: 'knowledge_articles__get_article', input: { key: 'payments.refunds.overpayment_refund' } },
        { toolCallId: 'call-2', toolName: 'tickets__get_ticket', input: { ticketId: 'ticket-1' } },
      ],
      toolResults: [
        { toolCallId: 'call-2', output: { number: 'TCK-000002' } },
        { toolCallId: 'call-1', output: { key: 'payments.refunds.overpayment_refund', version: 3 } },
      ],
    })

    expect(records).toEqual([
      {
        toolName: 'knowledge_articles__get_article',
        args: { key: 'payments.refunds.overpayment_refund' },
        result: { key: 'payments.refunds.overpayment_refund', version: 3 },
        durationMs: 0,
      },
      {
        toolName: 'tickets__get_ticket',
        args: { ticketId: 'ticket-1' },
        result: { number: 'TCK-000002' },
        durationMs: 0,
      },
    ])
  })

  it('records tool-error content parts as the call error', () => {
    const [record] = extractStepToolCalls({
      toolCalls: [{ toolCallId: 'call-1', toolName: 'reservations__get_details', input: { reservationId: 'missing' } }],
      content: [{ type: 'tool-error', toolCallId: 'call-1', error: new Error('Reservation not found') }],
    })

    expect(record.error).toEqual({ code: 'tool_error', message: 'Reservation not found' })
    expect(record.result).toBeUndefined()
  })

  it('keeps the legacy args/result fields as a fallback', () => {
    const [record] = extractStepToolCalls({
      toolCalls: [{ toolName: 'legacy_tool', args: { q: 'x' }, result: { ok: true }, startTime: 10, endTime: 25 }],
    })

    expect(record).toEqual({ toolName: 'legacy_tool', args: { q: 'x' }, result: { ok: true }, durationMs: 15 })
  })
})
