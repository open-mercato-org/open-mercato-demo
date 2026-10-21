import { describe, test, expect, jest } from '@jest/globals'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * AO delta spec §E.1 — the `proposal.ready` resume signal carries the option the
 * disposition selected, so a downstream step can run THAT option (additive field).
 */

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

const sendSignal = jest.fn<(...args: unknown[]) => Promise<void>>(async () => {})
jest.mock('@open-mercato/core/modules/workflows/lib/signal-handler', () => ({
  sendSignal: (...args: unknown[]) => sendSignal(...args),
}))

import { resumeWorkflowForProposal } from '../lib/disposition/resume'

const BASE = {
  proposalId: '44444444-4444-4444-8444-444444444444',
  workflowInstanceId: '66666666-6666-4666-8666-666666666666',
  stepId: 'resolve',
  disposition: 'approved' as const,
  proposalPayload: { options: [] },
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

describe('proposal.ready resume signal', () => {
  test('carries the selected option id', async () => {
    sendSignal.mockClear()
    await resumeWorkflowForProposal({} as AwilixContainer, {} as EntityManager, { ...BASE, selectedOptionId: 'refund' })

    const [, , request] = sendSignal.mock.calls[0] as [unknown, unknown, { payload: Record<string, unknown> }]
    expect(request.payload).toEqual({
      proposalId: BASE.proposalId,
      stepId: 'resolve',
      disposition: 'approved',
      selectedOptionId: 'refund',
      proposalPayload: BASE.proposalPayload,
    })
  })

  test('sends null when no option was selected', async () => {
    sendSignal.mockClear()
    await resumeWorkflowForProposal({} as AwilixContainer, {} as EntityManager, { ...BASE, disposition: 'rejected' })

    const [, , request] = sendSignal.mock.calls[0] as [unknown, unknown, { payload: Record<string, unknown> }]
    expect(request.payload.selectedOptionId).toBeNull()
  })
})
