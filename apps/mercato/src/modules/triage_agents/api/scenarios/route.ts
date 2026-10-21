import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { TRIAGE_SCENARIOS } from '../../lib/scenarios'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tickets.intake.simulate'] },
}

const scenarioSchema = z.object({
  key: z.string(),
  persona: z.string(),
  fromName: z.string(),
  fromEmail: z.string(),
  subject: z.string(),
  body: z.string(),
  expectedRoute: z.enum(['assisted', 'manual']),
  expectedReasonCode: z.string().nullable(),
})

export async function GET() {
  return NextResponse.json({ items: TRIAGE_SCENARIOS })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Triage Agents',
  summary: 'Demo triage scenarios',
  methods: {
    GET: {
      summary: 'The six demo scenario emails',
      description: 'Scenario presets for the "Send demo scenario" toolbar action. Each preset is posted to POST /api/tickets/intake/simulate.',
      responses: [{ status: 200, description: 'Scenario presets', schema: z.object({ items: z.array(scenarioSchema) }) }],
    },
  },
}
