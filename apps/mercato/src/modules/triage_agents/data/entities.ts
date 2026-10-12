import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import type { TriageAiMode, TriageDraftState, TriageGroundingState, TriageStage } from './constants'

export type TriageRunIds = {
  identifier?: string | null
  classifier?: string | null
  advisor?: string | null
}

export type TriageAttemptRecord = {
  attempt: number
  workflowInstanceId: string | null
  processExecutionId: string | null
  stage: TriageStage
  aiMode: TriageAiMode | null
  reasonCode: string | null
  disposition: string | null
  recordedAt: string
}

@Entity({ tableName: 'ticket_triages' })
@Unique({ name: 'ticket_triages_ticket_unique', properties: ['organizationId', 'ticketId'] })
@Index({ name: 'ticket_triages_scope_idx', properties: ['tenantId', 'organizationId', 'aiMode'] })
@Index({ name: 'ticket_triages_workflow_idx', properties: ['organizationId', 'workflowInstanceId'] })
@Index({ name: 'ticket_triages_proposal_idx', properties: ['organizationId', 'proposalId'] })
export class TicketTriage {
  [OptionalProps]?: 'stage' | 'draftState' | 'groundingState' | 'attempt' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'ticket_id', type: 'uuid' })
  ticketId!: string

  @Property({ name: 'ticket_number', type: 'varchar', length: 64, nullable: true })
  ticketNumber?: string | null

  @Property({ name: 'process_execution_id', type: 'uuid', nullable: true })
  processExecutionId?: string | null

  @Property({ name: 'workflow_instance_id', type: 'uuid', nullable: true })
  workflowInstanceId?: string | null

  @Property({ name: 'stage', type: 'text', default: 'queued' })
  stage: TriageStage = 'queued'

  @Property({ name: 'ai_mode', type: 'text', nullable: true })
  aiMode?: TriageAiMode | null

  @Property({ name: 'reason_code', type: 'varchar', length: 100, nullable: true })
  reasonCode?: string | null

  @Property({ name: 'reason', type: 'text', nullable: true })
  reason?: string | null

  @Property({ name: 'route', type: 'varchar', length: 20, nullable: true })
  route?: string | null

  @Property({ name: 'priority', type: 'varchar', length: 20, nullable: true })
  priority?: string | null

  @Property({ name: 'priority_reason', type: 'text', nullable: true })
  priorityReason?: string | null

  @Property({ name: 'identification', type: 'jsonb', nullable: true })
  identification?: Record<string, unknown> | null

  @Property({ name: 'classification', type: 'jsonb', nullable: true })
  classification?: Record<string, unknown> | null

  @Property({ name: 'uncertainty', type: 'jsonb', nullable: true })
  uncertainty?: Array<Record<string, unknown>> | null

  @Property({ name: 'confidence', type: 'numeric', precision: 5, scale: 4, nullable: true })
  confidence?: string | null

  @Property({ name: 'recommended_action_label', type: 'varchar', length: 200, nullable: true })
  recommendedActionLabel?: string | null

  @Property({ name: 'proposal_id', type: 'uuid', nullable: true })
  proposalId?: string | null

  @Property({ name: 'disposition', type: 'varchar', length: 40, nullable: true })
  disposition?: string | null

  @Property({ name: 'draft_state', type: 'text', default: 'none' })
  draftState: TriageDraftState = 'none'

  @Property({ name: 'grounding_state', type: 'text', default: 'not_checked' })
  groundingState: TriageGroundingState = 'not_checked'

  @Property({ name: 'grounding_issues', type: 'jsonb', nullable: true })
  groundingIssues?: string[] | null

  @Property({ name: 'run_ids', type: 'jsonb', nullable: true })
  runIds?: TriageRunIds | null

  @Property({ name: 'attempt', type: 'int', default: 1 })
  attempt: number = 1

  @Property({ name: 'attempts', type: 'jsonb', nullable: true })
  attempts?: TriageAttemptRecord[] | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
