import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { KnowledgeArticle, KnowledgeArticleVersion, KnowledgeCategory } from '../data/entities'
import type {
  KnowledgeAutomationLevel,
  KnowledgePriorityFloor,
  KnowledgeProcedureStep,
  KnowledgeRecommendedAction,
  KnowledgeRequiredCheck,
} from '../data/validators'
import { buildArticleSnapshot, loadArticleByKey, loadCategoryByKey, type KnowledgeScope } from './repository'

type SeedCategory = {
  key: string
  name: string
  description: string
  position: number
  subcategories: Array<{ key: string; name: string; description: string; position: number }>
}

export type SeedArticle = {
  subcategoryKey: string
  key: string
  title: string
  summary: string
  keywords: string[]
  body: string
  applicability: string
  procedureSteps: KnowledgeProcedureStep[]
  requiredChecks: KnowledgeRequiredCheck[]
  recommendedActions: KnowledgeRecommendedAction[]
  automationLevel: KnowledgeAutomationLevel
  manualReason: string | null
  targetQueueKey: string | null
  priorityFloor: KnowledgePriorityFloor | null
  replyTemplate: string | null
  publishedVersion: number
}

export const KNOWLEDGE_SEED_CATEGORIES: SeedCategory[] = [
  {
    key: 'payments',
    name: 'Payments',
    description: 'Incoming payments, overpayments and refunds.',
    position: 10,
    subcategories: [
      { key: 'payments.refunds', name: 'Refunds', description: 'Returning money to the customer.', position: 10 },
      { key: 'payments.incoming', name: 'Incoming payments', description: 'Confirming that a customer payment was received.', position: 20 },
    ],
  },
  {
    key: 'booking',
    name: 'Booking',
    description: 'Changes and special requests for existing reservations.',
    position: 20,
    subcategories: [
      { key: 'booking.special_requests', name: 'Special requests', description: 'Room preferences and other wishes passed to the hotel.', position: 10 },
      { key: 'booking.changes', name: 'Changes', description: 'Changing dates, travellers or the booked service.', position: 20 },
    ],
  },
  {
    key: 'complaints',
    name: 'Complaints',
    description: 'Complaints about services delivered during the trip.',
    position: 30,
    subcategories: [
      { key: 'complaints.service', name: 'Service', description: 'Complaints about the hotel or local service quality.', position: 10 },
    ],
  },
  {
    key: 'general',
    name: 'General',
    description: 'Cross-cutting topics and fallbacks.',
    position: 40,
    subcategories: [
      { key: 'general.identification', name: 'Identification', description: 'Requests that cannot be matched to a customer or booking.', position: 10 },
    ],
  },
]

export const OVERPAYMENT_REFUND_KEY = 'payments.refunds.overpayment_refund'

export const KNOWLEDGE_SEED_ARTICLES: SeedArticle[] = [
  {
    subcategoryKey: 'payments.refunds',
    key: OVERPAYMENT_REFUND_KEY,
    title: 'Overpayment refund',
    summary: 'The customer paid more than the booking total and asks for the difference back.',
    keywords: ['refund', 'overpayment', 'overpaid', 'paid twice', 'money back', 'IBAN', 'bank account'],
    body:
      'Customers sometimes pay a deposit twice or transfer the full amount after already paying by card. The difference between the payments booked on the reservation and the reservation total is an overpayment. We refund only the overpaid amount, to the bank account the customer provides, after confirming they own the booking.',
    applicability:
      'Use when the customer reports paying too much for an existing booking (double payment, duplicate transfer, paid more than the invoice) and asks for the difference to be returned.',
    procedureSteps: [
      { id: 'S1', text: 'Verify that the requester owns the booking (the sender matches the booking contact).', checkKey: 'owner_verified' },
      { id: 'S2', text: 'Confirm the overpayment from the payment ledger: payments booked minus the reservation total must be greater than zero.', checkKey: 'overpayment_confirmed' },
      { id: 'S3', text: 'Confirm that a valid IBAN for the refund is provided in the request.', checkKey: 'iban_present' },
      { id: 'S4', text: 'Request the refund for the overpaid amount only, never more than the confirmed overpayment.', actionKey: 'reservations.refund.request' },
      { id: 'S5', text: 'Reply to the customer with the confirmation template.', actionKey: 'tickets.reply.send' },
    ],
    requiredChecks: [
      { key: 'owner_verified', label: 'Requester owns the booking', description: 'The sender matches the booking contact on the reservation.' },
      { key: 'overpayment_confirmed', label: 'Overpayment confirmed', description: 'Payments booked exceed the reservation total.' },
      { key: 'iban_present', label: 'Valid IBAN provided', description: 'The request contains a valid IBAN for the refund transfer.' },
    ],
    recommendedActions: [
      { actionKey: 'reservations.refund.request', label: 'Request refund of the overpaid amount', requiresApproval: true, preconditions: ['owner_verified', 'overpayment_confirmed', 'iban_present'] },
      { actionKey: 'tickets.reply.send', label: 'Send the confirmation reply', requiresApproval: true },
    ],
    automationLevel: 'assisted',
    manualReason: null,
    targetQueueKey: null,
    priorityFloor: null,
    replyTemplate:
      'Dear {{customer.firstName}},\n\nWe confirm that we have registered your request to refund the overpayment of {{refund.amount}} for booking {{reservation.bookingNumber}}. The amount will be returned to the bank account you provided.\n\nKind regards,\nCustomer Service',
    publishedVersion: 3,
  },
  {
    subcategoryKey: 'payments.incoming',
    key: 'payments.incoming.payment_confirmation',
    title: 'Payment confirmation',
    summary: 'The customer asks whether their payment for a booking has been received.',
    keywords: ['payment', 'paid', 'transfer', 'confirmation', 'received', 'deposit'],
    body:
      'Customers often ask us to confirm that a transfer reached us. If the payment is visible on the reservation we confirm it and close the ticket. If it is not visible yet, a consultant has to check the bank statement manually.',
    applicability: 'Use when the customer asks whether a payment or deposit for an existing booking was received.',
    procedureSteps: [
      { id: 'S1', text: 'Check whether the payment is booked on the reservation.', checkKey: 'payment_booked' },
      { id: 'S2', text: 'If the payment is booked, mark the ticket as resolved.', actionKey: 'tickets.ticket.transition' },
      { id: 'S3', text: 'Reply with the payment confirmation template.', actionKey: 'tickets.reply.send' },
      { id: 'S4', text: 'If the payment is not visible, route the ticket to manual review with the reason payment_not_visible.' },
    ],
    requiredChecks: [
      { key: 'payment_booked', label: 'Payment booked on the reservation', description: 'A payment matching the customer transfer is visible in the payment ledger.' },
    ],
    recommendedActions: [
      { actionKey: 'tickets.ticket.transition', label: 'Resolve the ticket', requiresApproval: true, preconditions: ['payment_booked'] },
      { actionKey: 'tickets.reply.send', label: 'Send the payment confirmation', requiresApproval: true, preconditions: ['payment_booked'] },
    ],
    automationLevel: 'assisted',
    manualReason: 'payment_not_visible',
    targetQueueKey: null,
    priorityFloor: null,
    replyTemplate:
      'Dear {{customer.firstName}},\n\nWe confirm that we have received your payment of {{payment.amount}} for booking {{reservation.bookingNumber}}. No further action is needed on your side.\n\nKind regards,\nCustomer Service',
    publishedVersion: 1,
  },
  {
    subcategoryKey: 'booking.special_requests',
    key: 'booking.special_requests.room_preference',
    title: 'Room preference',
    summary: 'The customer asks for a specific room (sea view, high floor, connecting rooms).',
    keywords: ['room', 'sea view', 'floor', 'balcony', 'connecting rooms', 'preference', 'wish'],
    body: 'Room wishes are passed to the hotel but are never guaranteed. A consultant decides how to word the answer.',
    applicability: 'Use when the customer asks for a particular room type, view, floor or room location for an existing booking.',
    procedureSteps: [
      { id: 'S1', text: 'Forward the request to the hotel and note it on the booking.' },
      { id: 'S2', text: 'Tell the customer the wish was passed on without a guarantee.' },
    ],
    requiredChecks: [],
    recommendedActions: [],
    automationLevel: 'manual_only',
    manualReason: 'Requests are forwarded to the hotel without a guarantee — the consultant decides.',
    targetQueueKey: null,
    priorityFloor: null,
    replyTemplate: null,
    publishedVersion: 1,
  },
  {
    subcategoryKey: 'booking.changes',
    key: 'booking.changes.date_change',
    title: 'Date change',
    summary: 'The customer wants to move the trip to different dates.',
    keywords: ['change dates', 'reschedule', 'postpone', 'move booking', 'date change'],
    body: 'Date changes depend on availability and the fare conditions of the booking. A consultant checks options with the supplier.',
    applicability: 'Use when the customer asks to change the travel dates of an existing booking.',
    procedureSteps: [
      { id: 'S1', text: 'Check the fare conditions and change fees of the booking.' },
      { id: 'S2', text: 'Ask the supplier for availability on the requested dates.' },
      { id: 'S3', text: 'Offer the customer the available options with any price difference.' },
    ],
    requiredChecks: [],
    recommendedActions: [],
    automationLevel: 'manual_only',
    manualReason: 'Date changes require checking supplier availability and fare conditions.',
    targetQueueKey: null,
    priorityFloor: null,
    replyTemplate: null,
    publishedVersion: 1,
  },
  {
    subcategoryKey: 'complaints.service',
    key: 'complaints.service.hotel_service_complaint',
    title: 'Hotel service complaint',
    summary: 'The customer complains about the hotel or service quality during the stay.',
    keywords: ['complaint', 'dirty', 'noise', 'bad service', 'hotel', 'compensation', 'disappointed'],
    body: 'Complaints are handled by the complaints team. They collect evidence from the customer and the hotel before proposing any compensation.',
    applicability: 'Use when the customer complains about the hotel, room condition, staff or service quality during or after the stay.',
    procedureSteps: [
      { id: 'S1', text: 'Acknowledge the complaint and route it to the complaints queue.' },
      { id: 'S2', text: 'Collect evidence (photos, dates, names) from the customer and the hotel.' },
      { id: 'S3', text: 'Decide on compensation according to the complaints policy.' },
    ],
    requiredChecks: [],
    recommendedActions: [],
    automationLevel: 'manual_only',
    manualReason: 'Complaints are handled by the complaints team.',
    targetQueueKey: 'complaints',
    priorityFloor: 'normal',
    replyTemplate: null,
    publishedVersion: 1,
  },
  {
    subcategoryKey: 'general.identification',
    key: 'general.identification.unknown_booking',
    title: 'Unknown booking',
    summary: 'The request cannot be matched to a customer or booking.',
    keywords: ['unknown', 'no booking number', 'unidentified', 'who are you'],
    body: 'Fallback topic used when the sender or the booking cannot be identified. A consultant asks for the booking number before doing anything else.',
    applicability: 'Use when the ticket cannot be linked to a known customer or reservation, or the context is ambiguous.',
    procedureSteps: [
      { id: 'S1', text: 'Ask the customer for the booking number and the name of the lead traveller.' },
    ],
    requiredChecks: [],
    recommendedActions: [],
    automationLevel: 'manual_only',
    manualReason: 'The customer or booking could not be identified.',
    targetQueueKey: null,
    priorityFloor: null,
    replyTemplate: null,
    publishedVersion: 1,
  },
]

async function ensureCategory(
  em: EntityManager,
  scope: KnowledgeScope,
  input: { key: string; name: string; description: string; position: number; level: 'category' | 'subcategory'; parentId: string | null },
): Promise<KnowledgeCategory> {
  const existing = await loadCategoryByKey(em, scope, input.key)
  if (existing) return existing
  const category = em.create(KnowledgeCategory, {
    id: randomUUID(),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    parentId: input.parentId,
    level: input.level,
    key: input.key,
    name: input.name,
    description: input.description,
    position: input.position,
    isActive: true,
  })
  em.persist(category)
  await em.flush()
  return category
}

export async function seedKnowledgeBase(em: EntityManager, scope: KnowledgeScope): Promise<{ categories: number; articles: number }> {
  const subcategories = new Map<string, { category: KnowledgeCategory; subcategory: KnowledgeCategory }>()
  let categoryCount = 0
  for (const root of KNOWLEDGE_SEED_CATEGORIES) {
    const category = await ensureCategory(em, scope, { ...root, level: 'category', parentId: null })
    categoryCount += 1
    for (const child of root.subcategories) {
      const subcategory = await ensureCategory(em, scope, { ...child, level: 'subcategory', parentId: category.id })
      subcategories.set(child.key, { category, subcategory })
      categoryCount += 1
    }
  }
  let articleCount = 0
  for (const seed of KNOWLEDGE_SEED_ARTICLES) {
    const existing = await loadArticleByKey(em, scope, seed.key)
    if (existing) continue
    const path = subcategories.get(seed.subcategoryKey)
    if (!path) continue
    const publishedAt = new Date()
    const article = em.create(KnowledgeArticle, {
      id: randomUUID(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      categoryId: path.subcategory.id,
      key: seed.key,
      title: seed.title,
      summary: seed.summary,
      keywords: seed.keywords,
      body: seed.body,
      procedureSteps: seed.procedureSteps,
      applicability: seed.applicability,
      requiredChecks: seed.requiredChecks,
      recommendedActions: seed.recommendedActions,
      automationLevel: seed.automationLevel,
      manualReason: seed.manualReason,
      targetQueueKey: seed.targetQueueKey,
      priorityFloor: seed.priorityFloor,
      replyTemplate: seed.replyTemplate,
      status: 'published',
      version: seed.publishedVersion,
      publishedAt,
    })
    em.persist(article)
    await em.flush()
    const version = em.create(KnowledgeArticleVersion, {
      id: randomUUID(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      articleId: article.id,
      articleKey: article.key,
      version: seed.publishedVersion,
      snapshot: buildArticleSnapshot({
        article,
        version: seed.publishedVersion,
        category: path.category,
        subcategory: path.subcategory,
        publishedAt,
      }),
      publishedByUserId: null,
      createdAt: publishedAt,
    })
    em.persist(version)
    await em.flush()
    articleCount += 1
  }
  return { categories: categoryCount, articles: articleCount }
}
