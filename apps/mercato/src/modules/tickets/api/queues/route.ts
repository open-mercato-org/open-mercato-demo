import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { loadTicketQueueOptions } from '../../lib/dictionaries'
import { handleRouteError, resolveRouteContext, routeEm } from '../../lib/routeHelpers'
import { ticketsErrorSchema, ticketsTag } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tickets.view'] },
}

const responseSchema = z.object({
  items: z.array(z.object({ value: z.string(), label: z.string(), color: z.string().nullable() })),
})

export async function GET(req: Request) {
  try {
    const context = await resolveRouteContext(req)
    const items = await loadTicketQueueOptions(routeEm(context), {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
    return NextResponse.json({ items })
  } catch (err) {
    return handleRouteError(err, 'tickets.queues.list')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: ticketsTag,
  summary: 'Ticket queues',
  methods: {
    GET: {
      summary: 'List the ticket queues configured in the `tickets.queue` dictionary',
      responses: [{ status: 200, description: 'Queues', schema: responseSchema }],
      errors: [{ status: 401, description: 'Unauthorized', schema: ticketsErrorSchema }],
    },
  },
}
