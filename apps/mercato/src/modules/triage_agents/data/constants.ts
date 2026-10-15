export const TRIAGE_AGENTS_MODULE_ID = 'triage_agents'

export const CONTEXT_IDENTIFIER_AGENT_ID = 'triage_agents.context_identifier'
export const CLASSIFIER_AGENT_ID = 'triage_agents.classifier'
export const RESOLUTION_ADVISOR_AGENT_ID = 'triage_agents.resolution_advisor'

export const TRIAGE_PROCESS_KEY = 'triage_agents.ticket_triage'
export const TRIAGE_WORKFLOW_ID = 'triage_agents_ticket_triage_v1'
export const TRIAGE_PROCESS_NAME = 'Ticket triage (AI)'

export const COMPUTE_PRIORITY_FUNCTION = 'triage_agents.compute_priority'
export const ROUTE_FUNCTION = 'triage_agents.route'
export const RECORD_STAGE_FUNCTION = 'triage_agents.record_stage'

export const TICKET_ENTITY_TYPE = 'tickets:ticket'
export const TICKET_TRIAGE_ENTITY_ID = 'triage_agents:ticket_triage'

export const CUSTOMER_MATCHES = ['confirmed', 'email_only', 'not_found'] as const

export const RESERVATION_MATCHES = [
  'explicit_number_verified',
  'single_reservation',
  'inferred_from_content',
  'ambiguous',
  'identity_mismatch',
  'not_found',
] as const

export const RESOLVED_RESERVATION_MATCHES = ['explicit_number_verified', 'single_reservation', 'inferred_from_content'] as const

export const ADVISOR_ACTION_TYPES = ['reservations.refund.request', 'tickets.ticket.transition', 'tickets.reply.send'] as const

export const TRIAGE_TICKET_STATUSES = ['open', 'pending_customer', 'pending_internal', 'resolved'] as const

export const TRIAGE_STAGES = [
  'queued',
  'identifying',
  'classifying',
  'advising',
  'awaiting_approval',
  'applying',
  'done',
  'failed',
] as const

export type TriageStage = (typeof TRIAGE_STAGES)[number]

export const TRIAGE_AI_MODES = ['assisted', 'manual_review'] as const

export type TriageAiMode = (typeof TRIAGE_AI_MODES)[number]

export const TRIAGE_DRAFT_STATES = ['none', 'prepared', 'sent', 'rejected'] as const

export type TriageDraftState = (typeof TRIAGE_DRAFT_STATES)[number]

export const TRIAGE_GROUNDING_STATES = ['not_checked', 'verified', 'unverified'] as const

export type TriageGroundingState = (typeof TRIAGE_GROUNDING_STATES)[number]

export const WORKFLOW_COMMAND_IDS = [
  'tickets.ticket.classify',
  'tickets.ticket.flag_manual_review',
  'tickets.ticket.transition',
  'tickets.reply.send',
  'reservations.refund.request',
] as const

export const WORKFLOW_GRANTED_FEATURES = [
  'tickets.view',
  'tickets.manage',
  'tickets.classify',
  'tickets.reply',
  'reservations.view',
  'reservations.refund.request',
  'knowledge_articles.view',
  'customers.people.view',
] as const

export const SUPPORT_CONSULTANT_ROLE = 'support_consultant'

export const SUPPORT_CONSULTANT_FEATURES = [
  'triage_agents.view',
  'agent_orchestrator.proposals.view',
  'agent_orchestrator.proposals.dispose',
  'customers.people.view',
  'customers.companies.view',
] as const

export const SUPPORT_CONSULTANT_HIDDEN_SIDEBAR_ITEMS = [
  '/backend/caseload',
  '/backend/overview',
  '/backend/audit',
] as const

export const DEMO_CONSULTANT_DEFAULT_EMAIL = 'consultant@acme.example'
