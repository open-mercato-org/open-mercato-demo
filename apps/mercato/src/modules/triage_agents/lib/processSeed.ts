import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import type { WorkflowDefinitionData } from '@open-mercato/core/modules/workflows/data/entities'
import type { WorkflowDefinitionAuthoring } from '@open-mercato/core/modules/workflows/lib/owned-definition'
import {
  readEnabledWorkflowCommandIds,
  writeEnabledWorkflowCommandIds,
  type WorkflowCommandConfigService,
} from '@open-mercato/core/modules/workflows/lib/workflow-command-settings'
import { listWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import { ProcessDefinition } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import type { ProcessTrigger } from '@open-mercato/enterprise/modules/agent_orchestrator/data/validators'
import {
  TRIAGE_AGENTS_MODULE_ID,
  TRIAGE_PROCESS_KEY,
  TRIAGE_PROCESS_NAME,
  TRIAGE_WORKFLOW_ID,
  WORKFLOW_COMMAND_IDS,
  WORKFLOW_GRANTED_FEATURES,
} from '../data/constants'
import type { TriageScope } from './kbArticles'

const logger = createLogger('triage_agents').child({ component: 'processSeed' })

const WORKFLOW_FILE = 'ticket-triage-workflow.json'
const EXAMPLE_SEGMENTS = ['src', 'modules', 'triage_agents', 'examples']

type ResolverLike = { resolve: <T = unknown>(name: string) => T }

type WorkflowSeedFile = {
  workflowId: string
  workflowName: string
  description?: string | null
  definition: WorkflowDefinitionData
  metadata?: Record<string, unknown> | null
  enabled?: boolean
}

export const TRIAGE_PROCESS_TRIGGERS: ProcessTrigger[] = [
  {
    kind: 'event',
    eventPattern: 'tickets.ticket.created',
    config: {
      filterConditions: [{ field: 'channel', operator: 'neq', value: 'api' }],
      contextMapping: [
        { targetKey: 'ticketId', sourceExpression: 'id' },
        { targetKey: 'ticketNumber', sourceExpression: 'number' },
      ],
    },
    priority: 0,
    enabled: true,
  },
  { kind: 'manual', requireFeatures: ['triage_agents.run'] },
]

export const TRIAGE_PROCESS_INPUT_SCHEMA = {
  type: 'object',
  required: ['ticketId'],
  properties: {
    ticketId: { type: 'string' },
    ticketNumber: { type: 'string' },
  },
}

function tryResolve<T>(container: ResolverLike, name: string): T | null {
  try {
    return container.resolve<T>(name)
  } catch {
    return null
  }
}

export function readTriageWorkflowSeed(cwd: string = process.cwd()): WorkflowSeedFile {
  const candidates = [
    path.join(cwd, ...EXAMPLE_SEGMENTS, WORKFLOW_FILE),
    path.join(cwd, 'apps', 'mercato', ...EXAMPLE_SEGMENTS, WORKFLOW_FILE),
  ]
  const file = candidates.find((candidate) => existsSync(candidate))
  if (!file) throw new Error(`[internal] Missing triage_agents workflow seed file: ${WORKFLOW_FILE}`)
  return JSON.parse(readFileSync(file, 'utf8')) as WorkflowSeedFile
}

/**
 * UPDATE_ENTITY and the approved-proposal effector both refuse workflow-safe
 * commands the tenant has not enabled. Adds the triage commands to the tenant's
 * list, keeping whatever the tenant (or the grandfathered defaults) already had.
 */
export async function enableTriageWorkflowCommands(container: ResolverLike, tenantId: string): Promise<string[] | null> {
  const moduleConfigService = tryResolve<WorkflowCommandConfigService>(container, 'moduleConfigService')
  if (!moduleConfigService) return null
  const current = await readEnabledWorkflowCommandIds(moduleConfigService, tenantId)
  const base = current ?? listWorkflowSafeCommands().filter((command) => command.defaultEnabled === true).map((command) => command.commandId)
  const next = Array.from(new Set([...base, ...WORKFLOW_COMMAND_IDS]))
  if (current && WORKFLOW_COMMAND_IDS.every((commandId) => current.includes(commandId))) return [...current]
  await writeEnabledWorkflowCommandIds(moduleConfigService, tenantId, next)
  return next
}

export async function findTriageProcessDefinition(em: EntityManager, scope: TriageScope): Promise<ProcessDefinition | null> {
  return em.findOne(ProcessDefinition, {
    workflowId: TRIAGE_WORKFLOW_ID,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
}

export type EnsureTriageProcessResult = {
  workflowDefinitionId: string | null
  processDefinitionId: string | null
  processCreated: boolean
  enabledCommands: string[] | null
}

/**
 * Idempotent: (re)writes the owned triage workflow definition with its execution
 * grant, enables the workflow-safe commands it uses, and creates the process
 * definition (event + manual trigger) when it does not exist yet. Soft-optional:
 * returns nulls when the workflows authoring service is unavailable.
 */
export async function ensureTriageProcess(
  container: ResolverLike,
  em: EntityManager,
  scope: TriageScope,
  options: { actorUserId?: string | null } = {},
): Promise<EnsureTriageProcessResult> {
  const authoring = tryResolve<WorkflowDefinitionAuthoring>(container, 'workflowDefinitionAuthoring')
  if (!authoring) {
    logger.warn('workflowDefinitionAuthoring unavailable; skipping the triage process seed', scope)
    return { workflowDefinitionId: null, processDefinitionId: null, processCreated: false, enabledCommands: null }
  }
  const seed = readTriageWorkflowSeed()
  const upsert = await authoring.upsertOwnedDefinition(em, {
    ownerModule: TRIAGE_AGENTS_MODULE_ID,
    ownerId: TRIAGE_PROCESS_KEY,
    workflowId: TRIAGE_WORKFLOW_ID,
    workflowName: seed.workflowName,
    description: seed.description ?? null,
    definition: seed.definition,
    metadata: seed.metadata ?? null,
    grantedFeatures: [...WORKFLOW_GRANTED_FEATURES],
    enabled: seed.enabled ?? true,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    actorUserId: options.actorUserId ?? null,
  })
  if (!upsert.ok) {
    logger.warn('A workflow with the triage workflow id is owned by someone else; leaving it untouched', scope)
  }
  let enabledCommands: string[] | null = null
  try {
    enabledCommands = await enableTriageWorkflowCommands(container, scope.tenantId)
  } catch (err) {
    logger.warn('Could not enable the triage workflow commands', { ...scope, error: err instanceof Error ? err.message : String(err) })
    reportError(err, { module: 'triage_agents', code: 'triage_agents.enable_commands_failed' })
  }
  const existing = await findTriageProcessDefinition(em, scope)
  if (existing) {
    existing.triggers = TRIAGE_PROCESS_TRIGGERS
    existing.inputSchema = TRIAGE_PROCESS_INPUT_SCHEMA
    existing.uiMetadata = { processKey: TRIAGE_PROCESS_KEY, ownerModule: TRIAGE_AGENTS_MODULE_ID }
    await em.flush()
    return {
      workflowDefinitionId: upsert.definition.id,
      processDefinitionId: existing.id,
      processCreated: false,
      enabledCommands,
    }
  }
  const created = em.create(ProcessDefinition, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    name: TRIAGE_PROCESS_NAME,
    description: 'Triages every new helpdesk ticket with AI: identification, KB classification, deterministic priority and routing, and a consultant-approved resolution.',
    workflowId: TRIAGE_WORKFLOW_ID,
    inputSchema: TRIAGE_PROCESS_INPUT_SCHEMA,
    triggers: TRIAGE_PROCESS_TRIGGERS,
    milestones: [],
    uiMetadata: { processKey: TRIAGE_PROCESS_KEY, ownerModule: TRIAGE_AGENTS_MODULE_ID },
    enabled: true,
    createdBy: options.actorUserId ?? null,
  })
  em.persist(created)
  await em.flush()
  return {
    workflowDefinitionId: upsert.definition.id,
    processDefinitionId: created.id,
    processCreated: true,
    enabledCommands,
  }
}
