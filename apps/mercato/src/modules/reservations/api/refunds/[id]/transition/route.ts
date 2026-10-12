import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { RESERVATION_REFUND_RESOURCE_KIND } from '../../../../data/constants'
import { refundTransitionSchema, type RefundTransitionInput } from '../../../../data/validators'
import {
  readRouteId,
  resolveReservationsRouteContext,
  toReservationsErrorResponse,
} from '../../../../lib/routeContext'
import { reservationsErrorSchema } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['reservations.refund.manage'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

const transitionBodySchema = refundTransitionSchema.omit({ id: true })

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function POST(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveReservationsRouteContext(req)
    const id = await readRouteId(routeCtx?.params)
    if (!id) {
      throw new CrudHttpError(404, { error: context.translate('reservations.errors.refundNotFound', 'Refund not found') })
    }
    const body = toRecord(await readJsonSafe(req, {}))
    const input: RefundTransitionInput = refundTransitionSchema.parse({ ...transitionBodySchema.parse(body), id })
    const userId = context.ctx.auth?.sub
    if (!userId) {
      throw new CrudHttpError(401, { error: context.translate('reservations.errors.unauthorized', 'Unauthorized') })
    }
    const guarded = await runRouteMutationGuards({
      container: context.ctx.container,
      req,
      auth: { userId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: RESERVATION_REFUND_RESOURCE_KIND,
        resourceId: id,
        operation: 'custom',
        mutationPayload: { ...input },
      },
    })
    if (!guarded.ok) return guarded.response
    const commandInput = guarded.modifiedPayload
      ? refundTransitionSchema.parse({ ...guarded.modifiedPayload, id })
      : input
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<RefundTransitionInput, { refundId: string; status: string }>(
      'reservations.refund.transition',
      { input: commandInput, ctx: context.ctx },
    )
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, id: result?.refundId ?? id, status: result?.status ?? commandInput.to })
  } catch (err) {
    return toReservationsErrorResponse(err, 'reservations.refund.transition')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Reservations',
  summary: 'Transition a reservation refund',
  methods: {
    POST: {
      summary: 'Approve, execute or reject a refund request',
      description:
        'Allowed transitions: requested → approved | rejected, approved → executed | rejected. Honors the optimistic-lock header for the refund `updatedAt`.',
      requestBody: { contentType: 'application/json', schema: transitionBodySchema },
      responses: [
        {
          status: 200,
          description: 'Refund transitioned',
          schema: z.object({ ok: z.literal(true), id: z.string().uuid(), status: z.string() }),
        },
        { status: 409, description: 'Optimistic lock conflict', schema: reservationsErrorSchema },
        { status: 422, description: 'Transition not allowed', schema: reservationsErrorSchema },
      ],
    },
  },
}
