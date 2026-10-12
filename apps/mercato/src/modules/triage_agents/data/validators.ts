import { z } from 'zod'
import { TRIAGE_PRIORITIES } from '../lib/priorityPolicy'
import { containsIban } from '../lib/pii'
import {
  ADVISOR_ACTION_TYPES,
  CUSTOMER_MATCHES,
  RESERVATION_MATCHES,
  RESOLVED_RESERVATION_MATCHES,
  TRIAGE_AI_MODES,
  TRIAGE_DRAFT_STATES,
  TRIAGE_STAGES,
  TRIAGE_TICKET_STATUSES,
} from './constants'

export const SUMMARY_MAX_LENGTH = 600
export const KB_CITATION_PATTERN = /^[a-z0-9_]+(?:\.[a-z0-9_]+)+@\d+(?:#(?:S\d+|check:[a-z0-9_]+|reply_template))?$/

const uuid = z.string().uuid()

export const uncertaintySchema = z.object({
  code: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(500),
  blocking: z.boolean(),
})

export type TriageUncertainty = z.infer<typeof uncertaintySchema>

export const identificationCandidateSchema = z.object({
  reservationId: uuid,
  bookingNumber: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(200),
  daysToDeparture: z.number().int().nullable(),
})

export const identificationSchema = z
  .object({
    customer: z.object({
      personId: uuid.nullable(),
      match: z.enum(CUSTOMER_MATCHES),
    }),
    reservation: z.object({
      reservationId: uuid.nullable(),
      bookingNumber: z.string().trim().min(1).max(64).nullable(),
      match: z.enum(RESERVATION_MATCHES),
      candidates: z.array(identificationCandidateSchema).max(20),
      departureDate: z.string().trim().min(1).max(40).nullable(),
      daysToDeparture: z.number().int().nullable(),
    }),
    evidence: z
      .array(z.object({ source: z.enum(['ticket', 'crm']), quote: z.string().trim().min(1).max(500) }))
      .max(20),
    uncertainty: z.array(uncertaintySchema).max(20),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((value, ctx) => {
    const { reservation, customer } = value
    const resolved = (RESOLVED_RESERVATION_MATCHES as readonly string[]).includes(reservation.match)
    if (resolved && !reservation.reservationId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reservation', 'reservationId'], message: 'A matched reservation needs its reservationId' })
    }
    if (!resolved && reservation.reservationId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reservation', 'reservationId'], message: 'An unresolved match must not name a reservation' })
    }
    if (reservation.match === 'ambiguous' && reservation.candidates.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reservation', 'candidates'], message: 'An ambiguous match lists at least two candidates' })
    }
    if (reservation.match === 'inferred_from_content' && !value.evidence.some((entry) => entry.source === 'ticket')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['evidence'], message: 'An inferred reservation quotes the ticket text it was inferred from' })
    }
    if (customer.match !== 'not_found' && !customer.personId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customer', 'personId'], message: 'A found customer needs its personId' })
    }
    if (resolved && value.evidence.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['evidence'], message: 'A matched reservation cites its evidence' })
    }
  })

export type TriageIdentification = z.infer<typeof identificationSchema>

export const contextIdentifierResultSchema = z.object({
  kind: z.literal('research'),
  data: identificationSchema,
})

export const classificationSchema = z
  .object({
    categoryKey: z.string().trim().min(1).max(200),
    subcategoryKey: z.string().trim().min(1).max(200),
    topicKey: z.string().trim().min(1).max(200),
    topicVersion: z.number().int().min(1).nullable(),
    summary: z.string().trim().min(1).max(SUMMARY_MAX_LENGTH),
    intent: z.string().trim().min(1).max(200),
    urgencySignal: z.enum(['none', 'raise_one']),
    urgencyEvidence: z.string().trim().max(500).nullable(),
    automationLevel: z.enum(['assisted', 'manual_only']),
    extracted: z.object({
      refundAmount: z.number().positive().nullable(),
      bankAccount: z.string().trim().max(64).nullable(),
      paymentDate: z.string().trim().max(40).nullable(),
    }),
    uncertainty: z.array(uncertaintySchema).max(20),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((value, ctx) => {
    if (containsIban(value.summary)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['summary'], message: 'The summary must not contain a full IBAN' })
    }
    const sentences = value.summary.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0)
    if (sentences.length > 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['summary'], message: 'The summary is at most three sentences' })
    }
    if (!value.topicKey.startsWith(`${value.subcategoryKey}.`) || !value.subcategoryKey.startsWith(`${value.categoryKey}.`)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['topicKey'], message: 'topicKey must sit under subcategoryKey, which must sit under categoryKey' })
    }
    if (value.urgencySignal === 'raise_one' && !value.urgencyEvidence) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['urgencyEvidence'], message: 'An urgency signal quotes its evidence' })
    }
  })

export type TriageClassification = z.infer<typeof classificationSchema>

export const classifierResultSchema = z.object({
  kind: z.literal('research'),
  data: classificationSchema,
})

const citationsSchema = z.array(z.string().trim().regex(KB_CITATION_PATTERN)).min(1).max(20)

export const refundRequestActionSchema = z.object({
  type: z.literal('reservations.refund.request'),
  payload: z.object({
    reservationId: uuid,
    amount: z.number().positive(),
    currencyCode: z.string().trim().length(3),
    bankAccountNumber: z.string().trim().min(8).max(64),
    reason: z.string().trim().min(1).max(500),
    relatedTicketId: uuid,
    sourceType: z.literal('agent_proposal'),
  }),
  citations: citationsSchema,
})

export const ticketTransitionActionSchema = z.object({
  type: z.literal('tickets.ticket.transition'),
  payload: z.object({
    id: uuid,
    to: z.enum(TRIAGE_TICKET_STATUSES),
  }),
  citations: citationsSchema,
})

export const replySendActionSchema = z.object({
  type: z.literal('tickets.reply.send'),
  payload: z.object({
    ticketId: uuid,
    subject: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(20_000).describe('format:long_text'),
    resolveAfterSend: z.boolean(),
  }),
  citations: citationsSchema,
})

export const advisorActionSchema = z.discriminatedUnion('type', [
  refundRequestActionSchema,
  ticketTransitionActionSchema,
  replySendActionSchema,
])

export type AdvisorAction = z.infer<typeof advisorActionSchema>

export const advisorOptionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(120),
  rationale: z.string().trim().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  actions: z.array(advisorActionSchema).min(1).max(ADVISOR_ACTION_TYPES.length),
})

export const advisorEvidenceSchema = z.object({
  checks: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(200),
        step: z.string().trim().regex(/^S\d+$/),
        passed: z.boolean(),
        evidence: z.string().trim().min(1).max(2000),
      }),
    )
    .max(50),
  citations: z
    .array(
      z.object({
        kind: z.literal('kb'),
        ref: z.string().trim().regex(KB_CITATION_PATTERN),
        label: z.string().trim().min(1).max(120),
        steps: z.array(z.string().trim().regex(/^S\d+$/)).max(50),
      }),
    )
    .min(1)
    .max(10),
  segments: z
    .array(
      z.object({
        source: z.enum(['template', 'generated']),
        ref: z.string().trim().regex(KB_CITATION_PATTERN).nullable(),
        text: z.string().min(1).max(5000),
      }),
    )
    .max(50),
  uncertainty: z.array(uncertaintySchema).max(20),
})

export function citationBase(ref: string): string {
  const hashIndex = ref.indexOf('#')
  return hashIndex === -1 ? ref : ref.slice(0, hashIndex)
}

export const advisorProposalSchema = z
  .object({
    options: z.array(advisorOptionSchema).max(1),
    rationale: z.string().trim().min(1).max(2000),
    evidence: advisorEvidenceSchema,
  })
  .superRefine((value, ctx) => {
    const citedBases = new Set(value.evidence.citations.map((citation) => citationBase(citation.ref)))
    value.options.forEach((option, optionIndex) => {
      const types = option.actions.map((action) => action.type)
      if (new Set(types).size !== types.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options', optionIndex, 'actions'], message: 'An action type appears at most once per option' })
      }
      option.actions.forEach((action, actionIndex) => {
        for (const ref of action.citations) {
          if (!citedBases.has(citationBase(ref))) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['options', optionIndex, 'actions', actionIndex, 'citations'],
              message: `Citation ${ref} does not name an article listed in evidence.citations`,
            })
          }
        }
        if (action.type === 'tickets.reply.send' && !value.evidence.segments.some((segment) => segment.source === 'template')) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['evidence', 'segments'], message: 'A reply draft marks the parts that come from the article template' })
        }
      })
    })
    if (value.options.length > 0 && value.evidence.checks.some((check) => !check.passed)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'A failed required check means no proposal (none_proposed)' })
    }
    if (value.options.length === 0 && !value.evidence.uncertainty.some((entry) => entry.blocking)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['evidence', 'uncertainty'], message: 'Proposing nothing states the blocking reason' })
    }
  })

export type AdvisorProposal = z.infer<typeof advisorProposalSchema>

export const resolutionAdvisorResultSchema = z.object({
  kind: z.literal('proposal'),
  proposal: advisorProposalSchema,
})

export const triageStageSchema = z.enum(TRIAGE_STAGES)
export const triageAiModeSchema = z.enum(TRIAGE_AI_MODES)
export const triageDraftStateSchema = z.enum(TRIAGE_DRAFT_STATES)

const looseRecord = z.record(z.string(), z.unknown())

export const recordStageArgsSchema = z.object({
  ticketId: uuid,
  ticketNumber: z.string().trim().max(64).nullable().optional(),
  stage: triageStageSchema,
  aiMode: triageAiModeSchema.nullable().optional(),
  reasonCode: z.string().trim().max(100).nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
  identification: looseRecord.nullable().optional(),
  classification: looseRecord.nullable().optional(),
  priority: looseRecord.nullable().optional(),
  route: looseRecord.nullable().optional(),
  advice: looseRecord.nullable().optional(),
  disposition: z.string().trim().max(40).nullable().optional(),
  draftState: triageDraftStateSchema.nullable().optional(),
  proposalId: uuid.nullable().optional(),
  effects: looseRecord.nullable().optional(),
  startAttempt: z.boolean().optional(),
})

export type RecordStageArgs = z.infer<typeof recordStageArgsSchema>

export const scenarioKeySchema = z.enum([
  'overpayment_refund',
  'payment_confirmed',
  'payment_not_visible',
  'room_preference',
  'hotel_complaint',
  'ambiguous_date_change',
])

export type ScenarioKey = z.infer<typeof scenarioKeySchema>

export const rerunBodySchema = z.object({
  supersede: z.boolean().optional(),
})

export const triagePriorityValueSchema = z.enum(TRIAGE_PRIORITIES)
