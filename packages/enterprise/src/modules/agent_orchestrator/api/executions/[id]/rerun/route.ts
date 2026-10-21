import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentProposal, ProcessDefinition } from '../../../../data/entities'
import { manualTrigger, parseProcessTriggers } from '../../../../lib/tasks/triggers'
import { findExecutionForFlow } from '../../../../lib/trace/flowLoader'
import { evaluateRerunGuard, RERUN_SUPERSEDE_REASON } from '../../../../lib/processes/rerunGuard'
import type { StartProcessExecutionInput, StartProcessExecutionResult } from '../../../../commands/processes'
import type { DisposeProposalCommandInput, DisposeProposalCommandResult } from '../../../../commands/dispose'

/**
 * Re-run one execution (spec §C2): start a NEW execution of the same process
 * definition (its current version) with the ORIGINAL trigger context — the
 * resolved input and the source entity — through the manual-start command.
 *
 * The new execution is linked to the original through
 * `triggered_by.rerunOfExecutionId` (no column: the module's migrations are
 * squash-only). Effectors are never replayed: the new run's proposal needs its own
 * disposition. A pending proposal on the original blocks the re-run with
 * `409 pending_proposal` unless `supersede: true`, which rejects it through the
 * normal dispose command with the reason `superseded_by_rerun`.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.processes.run'] },
}

const rerunBodySchema = z.object({ supersede: z.boolean().optional() })
const errorSchema = z.object({ error: z.string(), code: z.string().optional() })
const acceptedSchema = z.object({
  executionId: z.string().uuid(),
  rerunOfExecutionId: z.string().uuid(),
  supersededProposalIds: z.array(z.string().uuid()),
})

type RbacService = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

const GUARD_MESSAGES: Record<string, string> = {
  no_process_definition: 'This execution has no process definition to re-run.',
  no_manual_trigger: 'This process declares no manual trigger — add one to re-run it.',
  missing_trigger_features: 'Missing the features this process requires to be started by hand.',
  pending_proposal: 'The execution still has a pending proposal. Decide it first or re-run with supersede.',
  missing_dispose_feature: 'Superseding a pending proposal requires agent_orchestrator.proposals.dispose.',
}

type RouteContext = { params: Promise<{ id: string }> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId || !auth.sub) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }
  const tenantId = auth.tenantId
  const organizationId = auth.orgId
  const userId = auth.sub

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Execution not found' }, { status: 404 })
  }

  const parsed = rerunBodySchema.safeParse(await readJsonSafe(req, {}))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }
  const supersede = parsed.data.supersede === true

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { tenantId, organizationId }
  const original = await findExecutionForFlow(em, id, scope)
  if (!original) return NextResponse.json({ error: 'Execution not found' }, { status: 404 })

  const definition = original.processDefinitionId
    ? await findOneWithDecryption(
        em,
        ProcessDefinition,
        { id: original.processDefinitionId, ...scope, deletedAt: null },
        undefined,
        scope,
      )
    : null
  const manual = definition ? manualTrigger(parseProcessTriggers(definition.triggers)) : null
  const rbac = container.resolve('rbacService') as RbacService
  const manualFeaturesGranted =
    !manual || manual.requireFeatures.length === 0
      ? true
      : await rbac.userHasAllFeatures(userId, manual.requireFeatures, scope)

  const pending = original.workflowInstanceId
    ? await findWithDecryption(
        em,
        AgentProposal,
        { workflowInstanceId: original.workflowInstanceId, ...scope, disposition: 'pending', deletedAt: null },
        { orderBy: { createdAt: 'asc' } },
        scope,
      )
    : []
  const canDispose =
    supersede && pending.length > 0
      ? await rbac.userHasAllFeatures(userId, ['agent_orchestrator.proposals.dispose'], scope)
      : false

  const decision = evaluateRerunGuard({
    hasProcessDefinition: !!definition,
    manualTriggerDeclared: !!manual,
    manualTriggerFeaturesGranted: manualFeaturesGranted,
    pendingProposalIds: pending.map((proposal) => proposal.id),
    supersede,
    canDisposeProposals: canDispose,
  })
  if (!decision.allowed || !definition) {
    if (decision.allowed) {
      return NextResponse.json({ error: GUARD_MESSAGES.no_process_definition, code: 'no_process_definition' }, { status: 422 })
    }
    return NextResponse.json(
      {
        error: GUARD_MESSAGES[decision.code] ?? decision.code,
        code: decision.code,
        ...(decision.pendingProposalIds ? { pendingProposalIds: decision.pendingProposalIds } : {}),
      },
      { status: decision.status },
    )
  }

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId,
    organizationId,
    userId,
    resourceKind: 'agent_orchestrator.process_execution',
    resourceId: original.id,
    operation: 'custom',
    requestMethod: 'POST',
    requestHeaders: req.headers,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const commandBus = container.resolve('commandBus') as CommandBus
  const commandCtx: CommandRuntimeContext = {
    container,
    auth: { sub: userId, tenantId, orgId: organizationId } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: req,
  }
  const disposeCtx: CommandRuntimeContext = { ...commandCtx, request: undefined }

  let executionId: string
  try {
    for (const proposalId of decision.supersedeProposalIds) {
      await commandBus.execute<DisposeProposalCommandInput, DisposeProposalCommandResult>(
        'agent_orchestrator.proposals.dispose',
        {
          input: {
            proposalId,
            tenantId,
            organizationId,
            userId,
            disposition: 'rejected',
            reason: RERUN_SUPERSEDE_REASON,
          },
          ctx: disposeCtx,
        },
      )
    }
    const input = isRecord(original.input) ? original.input : {}
    const executed = await commandBus.execute<StartProcessExecutionInput, StartProcessExecutionResult>(
      'agent_orchestrator.processes.startExecution',
      {
        input: {
          tenantId,
          organizationId,
          processDefinitionId: definition.id,
          input,
          idempotencyKey: null,
          sourceEntityType: original.sourceEntityType ?? null,
          sourceEntityId: original.sourceEntityId ?? null,
          triggeredBy: { kind: 'manual', ref: userId, rerunOfExecutionId: original.id },
        },
        ctx: commandCtx,
      },
    )
    executionId = executed.result.executionId
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }

  if (guardResult?.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId,
      organizationId,
      userId,
      resourceKind: 'agent_orchestrator.process_execution',
      resourceId: original.id,
      operation: 'custom',
      requestMethod: 'POST',
      requestHeaders: req.headers,
      metadata: guardResult.metadata,
    })
  }

  return NextResponse.json(
    { executionId, rerunOfExecutionId: original.id, supersededProposalIds: decision.supersedeProposalIds },
    { status: 202 },
  )
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Re-run a process execution',
  methods: {
    POST: {
      summary: 'Start a new execution with the original trigger context',
      description:
        'Starts a new execution of the same process definition (current version) with the original execution input and source entity, through the manual-start command; the new execution records `triggered_by.rerunOfExecutionId`. Requires a declared manual trigger (and its requireFeatures). Refused with 409 `pending_proposal` while the original has a pending proposal unless `supersede: true`, which rejects it through the dispose command with reason `superseded_by_rerun` (requires agent_orchestrator.proposals.dispose). Effectors are never replayed. Accepts the execution id or the workflow instance id. Gated by agent_orchestrator.processes.run.',
      requestBody: { contentType: 'application/json', schema: rerunBodySchema },
      responses: [{ status: 202, description: 'Re-run accepted', schema: acceptedSchema }],
      errors: [
        { status: 400, description: 'Tenant context missing or invalid body', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        {
          status: 403,
          description: 'Missing processes.run, no manual trigger, missing trigger features, or supersede without proposals.dispose',
          schema: errorSchema,
        },
        { status: 404, description: 'Unknown execution id (or cross-tenant)', schema: errorSchema },
        { status: 409, description: 'pending_proposal — the original still awaits a decision', schema: errorSchema },
        { status: 422, description: 'The execution has no process definition', schema: errorSchema },
      ],
    },
  },
}
