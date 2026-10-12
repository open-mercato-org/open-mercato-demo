import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { RESERVATIONS_SERVICE } from '../../../../di'
import type { ReservationsService } from '../../../../lib/reservationsService'
import {
  readRouteId,
  resolveReservationsRouteContext,
  toReservationsErrorResponse,
} from '../../../../lib/routeContext'
import { balanceSchema, reservationsErrorSchema } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['reservations.view'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

export async function GET(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveReservationsRouteContext(req)
    const id = await readRouteId(routeCtx?.params)
    if (!id) {
      return NextResponse.json({ error: context.translate('reservations.errors.notFound', 'Reservation not found') }, { status: 404 })
    }
    const service = context.ctx.container.resolve<ReservationsService>(RESERVATIONS_SERVICE)
    const details = await service.getDetails({ tenantId: context.tenantId, organizationId: context.organizationId }, id)
    if (!details) {
      return NextResponse.json({ error: context.translate('reservations.errors.notFound', 'Reservation not found') }, { status: 404 })
    }
    return NextResponse.json(details.balance)
  } catch (err) {
    return toReservationsErrorResponse(err, 'reservations.balance.get')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Reservations',
  summary: 'Reservation balance',
  methods: {
    GET: {
      summary: 'Get the computed balance of a reservation',
      description:
        'Returns total price, booked payments, pending payments, counted refunds, outstanding amount, overpayment and days to departure. The balance is derived on every request and never stored.',
      responses: [
        { status: 200, description: 'Balance', schema: balanceSchema },
        { status: 404, description: 'Reservation not found', schema: reservationsErrorSchema },
      ],
    },
  },
}
