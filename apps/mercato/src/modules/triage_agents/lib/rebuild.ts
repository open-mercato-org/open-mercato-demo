import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { TRIAGE_WORKFLOW_ID } from '../data/constants'
import { TicketTriage } from '../data/entities'
import type { RecordStageArgs } from '../data/validators'
import type { TriageScope } from './kbArticles'
import { isRecord, recordTriageStage } from './projection'

type Loose = Record<string, unknown>

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function recordAt(context: Loose, key: string): Loose | null {
  const value = context[key]
  return isRecord(value) ? value : null
}

function functionResult(context: Loose, activityName: string): Loose | null {
  const output = recordAt(context, activityName)
  return output && isRecord(output.result) ? output.result : null
}

/**
 * Re-derives a ticket's projection from one triage workflow instance: everything the
 * projection holds is either in the instance context (agent outputs, function
 * results, dispositions) or follows from its status and current step.
 */
export function deriveStageArgs(context: Loose, status: string, currentStepId: string | null): RecordStageArgs | null {
  const ticketId = readString(context.ticketId)
  if (!ticketId) return null
  const route = functionResult(context, 'triage_route')
  const effects = functionResult(context, 'triage_effects')
  const disposition = readString(context.disposition)
  const advice = recordAt(context, 'advice')
  const base: RecordStageArgs = {
    ticketId,
    ticketNumber: readString(context.ticketNumber),
    stage: 'identifying',
    identification: recordAt(context, 'identification'),
    classification: recordAt(context, 'classification'),
    priority: functionResult(context, 'triage_priority'),
    route,
    proposalId: readString(context.proposalId) ?? readString(context.advisorProposalId),
  }
  if (status === 'FAILED' || status === 'CANCELLED') {
    return { ...base, stage: 'failed', aiMode: 'manual_review', reasonCode: 'ai_failed' }
  }
  if (status !== 'COMPLETED') {
    if (currentStepId === 'resolve' && base.proposalId && !disposition) return { ...base, stage: 'awaiting_approval', aiMode: 'assisted' }
    if (currentStepId === 'apply_proposal' || currentStepId === 'effected') return { ...base, stage: 'applying', disposition }
    if (currentStepId === 'resolve' && !disposition) return { ...base, stage: 'advising' }
    if (base.classification) return { ...base, stage: 'classifying' }
    return base
  }
  if (disposition === 'rejected') {
    return { ...base, stage: 'done', aiMode: 'manual_review', reasonCode: 'proposal_rejected', disposition, draftState: 'rejected' }
  }
  if (effects) {
    const ok = effects.ok === true
    return {
      ...base,
      stage: ok ? 'done' : 'failed',
      aiMode: ok ? 'assisted' : 'manual_review',
      ...(ok ? {} : { reasonCode: 'effector_failed' }),
      disposition,
      effects,
    }
  }
  if (route?.route === 'manual') return { ...base, stage: 'done', aiMode: 'manual_review' }
  if (advice) return { ...base, stage: 'done', aiMode: 'manual_review', advice }
  return { ...base, stage: 'failed', aiMode: 'manual_review', reasonCode: 'ai_failed' }
}

export async function rebuildTriageProjection(
  em: EntityManager,
  scope: TriageScope,
  options: { ticketId?: string | null } = {},
): Promise<{ instances: number; rebuilt: number }> {
  const instances = await findWithDecryption(
    em,
    WorkflowInstance,
    { workflowId: TRIAGE_WORKFLOW_ID, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { orderBy: { startedAt: 'asc' } },
    scope,
  )
  await em.nativeDelete(TicketTriage, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ...(options.ticketId ? { ticketId: options.ticketId } : {}),
  })
  let rebuilt = 0
  for (const instance of instances) {
    const context = isRecord(instance.context) ? instance.context : {}
    if (options.ticketId && context.ticketId !== options.ticketId) continue
    const args = deriveStageArgs(context, instance.status, instance.currentStepId ?? null)
    if (!args) continue
    await recordTriageStage(em, scope, args, instance.id)
    rebuilt += 1
  }
  return { instances: instances.length, rebuilt }
}
