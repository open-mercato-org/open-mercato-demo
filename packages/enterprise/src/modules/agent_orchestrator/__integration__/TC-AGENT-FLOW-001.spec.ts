import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomInt, randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteAgentOrchestratorRowsForOrganization,
  deleteAgentProposalsByIds,
  deleteAgentRunsByIds,
  deleteProcessExecutionsByProcessDefinitionIds,
  insertAgentProposalFixtures,
  insertProcessExecutionFixtures,
} from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-FLOW-001 — Process Flow Trace, re-run and the embedded decision card.
 * Source: `.ai/specs/enterprise/agent-orchestrator/2026-10-12-process-flow-trace-replay-and-embeddable-decision-card.md`
 * (§A, §B, §C2).
 *
 * - `GET /runs?workflowInstanceId=` returns only the caller organization's runs;
 * - `GET /executions/:id/flow` is 403 without `agent_orchestrator.trace.view`;
 * - `POST /executions/:id/rerun` refuses with `409 pending_proposal`, and with
 *   `supersede` rejects the pending proposal and links the new execution;
 * - the decision card embedded on the execution page disposes an EDIT with the
 *   whole envelope.
 *
 * Runs, proposals and executions come from the agent runtime and the workflow
 * worker, which no public API creates deterministically, so they are seeded via
 * the shared dbFixtures precedent (see `helpers/agentPerfFixtures.ts`); the
 * process definition is created through the API. Everything is removed in `finally`.
 */

const DEFINITIONS = '/api/agent_orchestrator/processes'
const AGENT_ID = 'deals.health_check'
const TEMPLATE_SENTENCE = 'We will refund the overpaid amount within five working days.'

function envelope(body: string) {
  return {
    options: [
      {
        id: 'refund',
        label: 'Refund the overpayment',
        confidence: 0.6,
        actions: [{ type: 'tickets.ticket.reply', payload: { body, channel: 'email' } }],
      },
    ],
    rationale: 'Seeded by TC-AGENT-FLOW-001',
    evidence: {
      checks: [{ key: 'overpayment_confirmed', step: 'S2', passed: true, evidence: 'paid more than the total' }],
      citations: [{ kind: 'kb', ref: 'payments.refunds.overpayment_refund@3', label: 'Overpayment refund (v3)' }],
      segments: [{ source: 'template', text: TEMPLATE_SENTENCE }],
    },
  }
}

async function insertRun(input: {
  tenantId: string
  organizationId: string
  workflowInstanceId: string
  stepId: string
}): Promise<string> {
  const id = randomUUID()
  await withClient(async (client) => {
    await client.query(
      `insert into agent_runs (id, tenant_id, organization_id, agent_id, status, input, workflow_instance_id, step_id, invocation_id, created_at, updated_at, completed_at)
       values ($1, $2, $3, $4, 'ok', '{}'::jsonb, $5, $6, $7, now(), now(), now())`,
      [id, input.tenantId, input.organizationId, AGENT_ID, input.workflowInstanceId, input.stepId, `inv-${id}`],
    )
  })
  return id
}

async function createManualDefinition(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', DEFINITIONS, {
    token,
    data: { name, workflowMode: 'workflow', workflowId: 'tc-agent-flow-001-workflow', triggers: [{ kind: 'manual' }], enabled: true },
  })
  expect(response.status(), 'definition create returns 201').toBe(201)
  const id = (await readJsonSafe<{ id?: string }>(response))?.id
  expect(id).toBeTruthy()
  return id as string
}

test.describe('TC-AGENT-FLOW-001: process flow trace, re-run, embedded decision card', () => {
  test('runs filter isolation, flow ACL, re-run guard and link', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    expect(tenantId && organizationId, 'admin token carries a tenant and an organization').toBeTruthy()
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const workflowInstanceId = randomUUID()
    const password = 'StrongSecret123!'

    let definitionId: string | null = null
    let otherOrgId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    const runIds: string[] = []
    const proposalIds: string[] = []

    try {
      definitionId = await createManualDefinition(request, adminToken, `TC-AGENT-FLOW-001 ${stamp}`)
      const [executionId] = await insertProcessExecutionFixtures([
        {
          tenantId,
          organizationId,
          processDefinitionId: definitionId,
          workflowInstanceId,
          status: 'waiting_on_you',
          triggeredBy: { kind: 'event', ref: 'tickets.ticket.created' },
          createdAt: new Date(),
        },
      ])
      const runId = await insertRun({ tenantId, organizationId, workflowInstanceId, stepId: 'advisor' })
      runIds.push(runId)
      proposalIds.push(
        ...(await insertAgentProposalFixtures([
          {
            tenantId,
            organizationId,
            agentId: AGENT_ID,
            runId,
            workflowInstanceId,
            stepId: 'advisor',
            payload: envelope(`Dear customer,\n${TEMPLATE_SENTENCE}`),
            createdAt: new Date(),
          },
        ])),
      )

      otherOrgId = await createOrganizationFixture(request, superadminToken, { name: `TC-AGENT-FLOW-001 other ${stamp}`, tenantId })
      const foreignRunId = await insertRun({ tenantId, organizationId: otherOrgId, workflowInstanceId, stepId: 'advisor' })
      runIds.push(foreignRunId)

      const runsResponse = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/runs?workflowInstanceId=${workflowInstanceId}&pageSize=50`,
        { token: adminToken },
      )
      expect(runsResponse.ok()).toBeTruthy()
      const runs = (await readJsonSafe<{ items?: Array<{ id: string }> }>(runsResponse))?.items ?? []
      expect(runs.map((row) => row.id)).toEqual([runId])
      expect(runs.map((row) => row.id)).not.toContain(foreignRunId)

      const flowResponse = await apiRequest(request, 'GET', `/api/agent_orchestrator/executions/${executionId}/flow`, {
        token: adminToken,
      })
      expect(flowResponse.status()).toBe(200)
      const flow = await readJsonSafe<{ execution?: { id: string }; nodes?: Array<{ kind: string; refs?: { runId?: string } }> }>(flowResponse)
      expect(flow?.execution?.id).toBe(executionId)
      const kinds = (flow?.nodes ?? []).map((node) => node.kind)
      expect(kinds[0]).toBe('trigger')
      expect(kinds).toEqual(expect.arrayContaining(['agent_run', 'disposition']))
      expect((flow?.nodes ?? []).some((node) => node.refs?.runId === foreignRunId)).toBe(false)

      roleId = await createRoleFixture(request, superadminToken, { name: `tc-agent-flow-001-${stamp}`, tenantId })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['agent_orchestrator.processes.view', 'agent_orchestrator.proposals.view'],
        organizations: null,
      })
      const email = `tc-agent-flow-001-${stamp}@example.com`
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: 'QA TC-AGENT-FLOW-001',
      })
      const limitedToken = await getAuthToken(request, email, password)
      const forbidden = await apiRequest(request, 'GET', `/api/agent_orchestrator/executions/${executionId}/flow`, {
        token: limitedToken,
      })
      expect(forbidden.status()).toBe(403)

      const blocked = await apiRequest(request, 'POST', `/api/agent_orchestrator/executions/${executionId}/rerun`, {
        token: adminToken,
        data: {},
      })
      expect(blocked.status()).toBe(409)
      expect(await readJsonSafe<{ code?: string }>(blocked)).toMatchObject({ code: 'pending_proposal' })

      const rerun = await apiRequest(request, 'POST', `/api/agent_orchestrator/executions/${executionId}/rerun`, {
        token: adminToken,
        data: { supersede: true },
      })
      expect(rerun.status()).toBe(202)
      const rerunBody = await readJsonSafe<{ executionId?: string; rerunOfExecutionId?: string; supersededProposalIds?: string[] }>(rerun)
      expect(rerunBody?.rerunOfExecutionId).toBe(executionId)
      expect(rerunBody?.supersededProposalIds).toEqual(proposalIds)
      expect(rerunBody?.executionId).toBeTruthy()
      expect(rerunBody?.executionId).not.toBe(executionId)

      const detail = await apiRequest(request, 'GET', `/api/agent_orchestrator/executions/${rerunBody?.executionId}`, {
        token: adminToken,
      })
      expect(detail.ok()).toBeTruthy()
      const detailBody = await readJsonSafe<{ execution?: { triggeredBy?: { kind?: string; rerunOfExecutionId?: string } } }>(detail)
      expect(detailBody?.execution?.triggeredBy).toMatchObject({ kind: 'manual', rerunOfExecutionId: executionId })

      const superseded = await apiRequest(request, 'GET', `/api/agent_orchestrator/proposals?id=${proposalIds[0]}`, {
        token: adminToken,
      })
      const supersededRow = (await readJsonSafe<{ items?: Array<{ disposition?: string; disposition_reason?: string }> }>(superseded))?.items?.[0]
      expect(supersededRow).toMatchObject({ disposition: 'rejected', disposition_reason: 'superseded_by_rerun' })
    } finally {
      await deleteAgentProposalsByIds(proposalIds).catch(() => {})
      await deleteAgentRunsByIds(runIds).catch(() => {})
      await deleteAgentOrchestratorRowsForOrganization(otherOrgId).catch(() => {})
      if (definitionId) {
        await deleteProcessExecutionsByProcessDefinitionIds([definitionId]).catch(() => {})
        await apiRequest(request, 'DELETE', `${DEFINITIONS}?id=${encodeURIComponent(definitionId)}`, { token: adminToken }).catch(() => {})
      }
      await deleteUserIfExists(request, superadminToken, userId).catch(() => {})
      await deleteRoleIfExists(request, superadminToken, roleId).catch(() => {})
      await deleteOrganizationIfExists(request, superadminToken, otherOrgId).catch(() => {})
    }
  })

  test('the decision card embedded on the execution page disposes an edit with the whole envelope', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const workflowInstanceId = randomUUID()
    let definitionId: string | null = null
    let proposalId: string | null = null
    let runId: string | null = null

    try {
      definitionId = await createManualDefinition(request, adminToken, `TC-AGENT-FLOW-001 card ${Date.now()}`)
      await insertProcessExecutionFixtures([
        { tenantId, organizationId, processDefinitionId: definitionId, workflowInstanceId, status: 'waiting_on_you', createdAt: new Date() },
      ])
      runId = await insertRun({ tenantId, organizationId, workflowInstanceId, stepId: 'advisor' })
      ;[proposalId] = await insertAgentProposalFixtures([
        {
          tenantId,
          organizationId,
          agentId: AGENT_ID,
          runId,
          workflowInstanceId,
          stepId: 'advisor',
          payload: envelope(`Dear customer,\n${TEMPLATE_SENTENCE}`),
          createdAt: new Date(),
        },
      ])

      await login(page, 'admin')
      await page.goto(`/backend/processes/${workflowInstanceId}`, { waitUntil: 'domcontentloaded' })
      const card = page.getByTestId('ao-proposal-decision-card')
      await expect(card).toBeVisible({ timeout: 20_000 })
      await expect(card.getByText('Overpayment refund (v3)')).toBeVisible()

      await card.getByRole('button', { name: 'Edit' }).click()
      const body = card.locator('textarea').first()
      await body.fill(`Dear Ms Doe,\n${TEMPLATE_SENTENCE}`)
      await card.getByRole('button', { name: 'Save & approve' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox').fill('Address the customer by name')
      await dialog.getByRole('textbox').press('ControlOrMeta+Enter')

      await expect
        .poll(
          async () => {
            const response = await apiRequest(request, 'GET', `/api/agent_orchestrator/proposals?id=${proposalId}`, { token: adminToken })
            const row = (await readJsonSafe<{ items?: Array<{ disposition?: string; payload?: unknown }> }>(response))?.items?.[0]
            return row?.disposition ?? null
          },
          { timeout: 15_000 },
        )
        .toBe('edited')
      const stored = await apiRequest(request, 'GET', `/api/agent_orchestrator/proposals?id=${proposalId}`, { token: adminToken })
      const row = (await readJsonSafe<{ items?: Array<{ payload?: ReturnType<typeof envelope>; selected_option_id?: string }> }>(stored))?.items?.[0]
      expect(row?.selected_option_id).toBe('refund')
      expect(row?.payload?.options[0].actions[0].payload).toEqual({ body: `Dear Ms Doe,\n${TEMPLATE_SENTENCE}`, channel: 'email' })
      expect(row?.payload?.evidence?.citations?.[0]?.ref).toBe('payments.refunds.overpayment_refund@3')
    } finally {
      await deleteAgentProposalsByIds(proposalId ? [proposalId] : []).catch(() => {})
      await deleteAgentRunsByIds(runId ? [runId] : []).catch(() => {})
      if (definitionId) {
        await deleteProcessExecutionsByProcessDefinitionIds([definitionId]).catch(() => {})
        await apiRequest(request, 'DELETE', `${DEFINITIONS}?id=${encodeURIComponent(definitionId)}`, { token: adminToken }).catch(() => {})
      }
    }
  })
})
