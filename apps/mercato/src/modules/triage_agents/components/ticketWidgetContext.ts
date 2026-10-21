type Reloader = () => Promise<void>

export type TicketWidgetContext = {
  ticketId: string | null
  reload: Reloader | null
  reloadDrafts: Reloader | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asReloader(value: unknown): Reloader | null {
  return typeof value === 'function' ? (value as Reloader) : null
}

function readId(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/**
 * Reads the ticket detail injection context (`tickets.detail.v1` / `tickets.composer.v1`):
 * the ticket id from `resourceId` (or the widget data: the ticket itself, or `{ ticket }`
 * on the composer spot) and the page's reload callbacks.
 */
export function readTicketWidgetContext(context: unknown, data: unknown): TicketWidgetContext {
  const ctx = asRecord(context)
  const record = asRecord(data)
  const fromContext = ctx?.resourceKind === 'tickets.ticket' ? readId(ctx.resourceId) : null
  const ticketId = fromContext ?? readId(asRecord(record?.ticket)?.id) ?? readId(record?.id)
  return {
    ticketId,
    reload: asReloader(ctx?.reload),
    reloadDrafts: asReloader(ctx?.reloadDrafts) ?? asReloader(record?.reloadDrafts),
  }
}
