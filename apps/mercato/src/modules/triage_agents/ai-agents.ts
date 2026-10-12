import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import { defineAgent } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import {
  ADVISOR_ACTION_TYPES,
  CLASSIFIER_AGENT_ID,
  CONTEXT_IDENTIFIER_AGENT_ID,
  RESOLUTION_ADVISOR_AGENT_ID,
  TRIAGE_AGENTS_MODULE_ID,
} from './data/constants'
import { classifierResultSchema, contextIdentifierResultSchema, resolutionAdvisorResultSchema } from './data/validators'
import { loadTriagePrompt } from './lib/prompts'

const MAX_STEPS = 8

const SAMPLE_TICKET_ID = '11111111-1111-4111-8111-111111111111'

const SAMPLE_IDENTIFICATION = {
  customer: { personId: '22222222-2222-4222-8222-222222222222', match: 'confirmed' },
  reservation: {
    reservationId: '33333333-3333-4333-8333-333333333333',
    bookingNumber: 'ABC123',
    match: 'explicit_number_verified',
    candidates: [],
    departureDate: '2026-10-15',
    daysToDeparture: 3,
  },
  evidence: [
    { source: 'ticket', quote: 'Please refund the overpayment on booking ABC123' },
    { source: 'crm', quote: 'ABC123 belongs to the sender' },
  ],
  uncertainty: [],
  confidence: 0.95,
}

const SAMPLE_CLASSIFICATION = {
  categoryKey: 'payments',
  subcategoryKey: 'payments.refunds',
  topicKey: 'payments.refunds.overpayment_refund',
  topicVersion: 3,
  summary: 'Anna Carter paid the second instalment for booking ABC123 twice and asks for the overpayment to be refunded. An IBAN was provided.',
  intent: 'refund an overpayment',
  urgencySignal: 'none',
  urgencyEvidence: null,
  automationLevel: 'assisted',
  extracted: { refundAmount: null, bankAccount: 'DE89 3704 0044 0532 0130 00', paymentDate: null },
  uncertainty: [],
  confidence: 0.92,
}

export const aiAgents: AiAgentDefinition[] = [
  defineAgent({
    id: CONTEXT_IDENTIFIER_AGENT_ID,
    moduleId: TRIAGE_AGENTS_MODULE_ID,
    label: 'Ticket context identifier',
    description: 'Identifies the customer and the reservation a helpdesk ticket is about, with match levels, evidence and uncertainty.',
    instructions: loadTriagePrompt('context_identifier'),
    tools: [
      'tickets.get_ticket',
      'tickets.list_tickets',
      'customers.list_people',
      'reservations.find_by_booking_number',
      'reservations.list_for_customer',
      'reservations.get_details',
    ],
    loop: { maxSteps: MAX_STEPS },
    agentType: 'researcher',
    result: { kind: 'research', schema: contextIdentifierResultSchema },
    sampleInput: { ticketId: SAMPLE_TICKET_ID },
  }),
  defineAgent({
    id: CLASSIFIER_AGENT_ID,
    moduleId: TRIAGE_AGENTS_MODULE_ID,
    label: 'Ticket classifier',
    description: 'Classifies a helpdesk ticket into a knowledge base topic and writes a short English summary with an urgency signal.',
    instructions: loadTriagePrompt('classifier'),
    tools: [
      'tickets.get_ticket',
      'knowledge_articles.browse_taxonomy',
      'knowledge_articles.search',
      'knowledge_articles.get_article',
    ],
    loop: { maxSteps: MAX_STEPS },
    agentType: 'researcher',
    result: { kind: 'research', schema: classifierResultSchema },
    sampleInput: { ticketId: SAMPLE_TICKET_ID, identification: SAMPLE_IDENTIFICATION },
  }),
  defineAgent({
    id: RESOLUTION_ADVISOR_AGENT_ID,
    moduleId: TRIAGE_AGENTS_MODULE_ID,
    label: 'Ticket resolution advisor',
    description: 'Follows the knowledge base article of the ticket topic, runs its checks against the reservation and proposes the recommended actions with a reply draft, citing the steps it followed.',
    instructions: loadTriagePrompt('resolution_advisor'),
    tools: ['knowledge_articles.get_article', 'reservations.get_details', 'tickets.get_ticket'],
    loop: { maxSteps: MAX_STEPS },
    agentType: 'decision_maker',
    allowedActions: [...ADVISOR_ACTION_TYPES],
    result: { kind: 'proposal', schema: resolutionAdvisorResultSchema },
    facts: [
      { label: 'Ticket', source: 'input', path: 'ticketNumber' },
      { label: 'Customer match', source: 'input', path: 'identification.customer.match' },
      { label: 'Booking number', source: 'input', path: 'identification.reservation.bookingNumber' },
      { label: 'Departure', source: 'input', path: 'identification.reservation.departureDate' },
      { label: 'Days to departure', source: 'input', path: 'identification.reservation.daysToDeparture', format: 'number' },
      { label: 'Topic', source: 'input', path: 'classification.topicKey' },
      { label: 'Recommended action', source: 'payload', path: 'options.0.label' },
      { label: 'First action amount', source: 'payload', path: 'options.0.actions.0.payload.amount', format: 'number' },
      { label: 'Knowledge base article', source: 'payload', path: 'evidence.citations.0.label' },
      { label: 'Classification confidence', source: 'input', path: 'classification.confidence', format: 'percent' },
    ],
    sampleInput: {
      ticketId: SAMPLE_TICKET_ID,
      ticketNumber: 'TCK-000123',
      identification: SAMPLE_IDENTIFICATION,
      classification: SAMPLE_CLASSIFICATION,
    },
  }),
]

export default aiAgents
