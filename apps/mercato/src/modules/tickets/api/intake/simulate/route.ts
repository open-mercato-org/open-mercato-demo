import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { simulateIntakeSchema } from '../../../data/validators'
import { TICKET_RESOURCE_KIND } from '../../../data/constants'
import { ingestInboundEmail } from '../../../lib/emailIntake'
import { normalizeMessageId } from '../../../lib/threadMatcher'
import { handleRouteError, readBody, resolveRouteContext, routeEm } from '../../../lib/routeHelpers'
import { ticketsErrorSchema, ticketsTag } from '../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['tickets.intake.simulate'] },
}

const responseSchema = z.object({
  ticketId: z.string().uuid(),
  number: z.string(),
  created: z.boolean(),
  articleId: z.string().uuid().nullable(),
  messageId: z.string(),
  match: z.enum(['message', 'token', 'new']),
})

function buildSimulatedMessageId(): string {
  return `<sim-${randomUUID()}@tickets.simulated>`
}

export async function POST(req: Request) {
  try {
    const context = await resolveRouteContext(req)
    const input = simulateIntakeSchema.parse(await readBody(req))
    const guard = await runRouteMutationGuards({
      container: context.ctx.container,
      req,
      auth: { userId: context.userId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: { resourceKind: TICKET_RESOURCE_KIND, resourceId: null, operation: 'create', mutationPayload: { ...input } },
    })
    if (!guard.ok) return guard.response
    const messageId = normalizeMessageId(input.messageId) ?? buildSimulatedMessageId()
    const result = await ingestInboundEmail({
      em: routeEm(context),
      container: context.ctx.container as AwilixContainer,
      scope: { tenantId: context.tenantId, organizationId: context.organizationId },
      channel: 'email',
      email: {
        fromEmail: input.fromEmail,
        fromName: input.fromName ?? null,
        subject: input.subject,
        bodyText: input.body,
        messageId,
        inReplyTo: input.inReplyTo ?? null,
        receivedAt: input.receivedAt ?? new Date(),
      },
    })
    await guard.runAfterSuccess()
    return NextResponse.json({
      ticketId: result.ticketId,
      number: result.number,
      created: result.created,
      articleId: result.articleId,
      messageId,
      match: result.match,
    }, { status: result.created ? 201 : 200 })
  } catch (err) {
    return handleRouteError(err, 'tickets.intake.simulate')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: ticketsTag,
  summary: 'Simulate inbound ticket email',
  methods: {
    POST: {
      summary: 'Feed a simulated inbound email through the ticket intake (demo)',
      description: 'Runs the same thread matching as real email intake: In-Reply-To → existing article, `[TCK-000123]` subject token → existing ticket, otherwise a new ticket.',
      requestBody: { contentType: 'application/json', schema: simulateIntakeSchema },
      responses: [
        { status: 201, description: 'New ticket created', schema: responseSchema },
        { status: 200, description: 'Appended to an existing ticket', schema: responseSchema },
      ],
      errors: [{ status: 400, description: 'Invalid input', schema: ticketsErrorSchema }],
    },
  },
}
