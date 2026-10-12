import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import {
  normalizeDictionaryValue,
  sanitizeDictionaryColor,
  sanitizeDictionaryIcon,
} from '@open-mercato/core/modules/dictionaries/lib/utils'
import { TICKET_QUEUE_DICTIONARY_KEY } from '../data/constants'

type SeedScope = {
  tenantId: string
  organizationId: string
}

export type TicketQueueSeed = {
  value: string
  label: string
  color?: string | null
  icon?: string | null
}

export type TicketQueueOption = {
  value: string
  label: string
  color: string | null
}

export const DEFAULT_TICKET_QUEUES: TicketQueueSeed[] = [
  { value: 'general', label: 'General', color: '#64748b', icon: 'lucide:inbox' },
  { value: 'payments', label: 'Payments', color: '#0d9488', icon: 'lucide:credit-card' },
  { value: 'complaints', label: 'Complaints', color: '#dc2626', icon: 'lucide:message-square-warning' },
  { value: 'bookings', label: 'Bookings', color: '#6366f1', icon: 'lucide:calendar-check' },
]

async function ensureQueueDictionary(em: EntityManager, scope: SeedScope): Promise<Dictionary> {
  const existing = await em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: TICKET_QUEUE_DICTIONARY_KEY,
    deletedAt: null,
  })
  if (existing) return existing
  const now = new Date()
  const dictionary = em.create(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: TICKET_QUEUE_DICTIONARY_KEY,
    name: 'Ticket queues',
    description: 'Helpdesk queues tickets are routed to.',
    isSystem: true,
    isActive: true,
    managerVisibility: 'default',
    createdAt: now,
    updatedAt: now,
  })
  em.persist(dictionary)
  await em.flush()
  return dictionary
}

export async function seedTicketQueues(
  em: EntityManager,
  scope: SeedScope,
  seeds: TicketQueueSeed[] = DEFAULT_TICKET_QUEUES,
): Promise<void> {
  const dictionary = await ensureQueueDictionary(em, scope)
  for (const seed of seeds) {
    const value = seed.value.trim()
    if (!value) continue
    const normalizedValue = normalizeDictionaryValue(value)
    const existing = await em.findOne(DictionaryEntry, {
      dictionary,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      normalizedValue,
    })
    if (existing) continue
    const now = new Date()
    const color = seed.color === undefined ? null : sanitizeDictionaryColor(seed.color)
    const icon = seed.icon === undefined ? null : sanitizeDictionaryIcon(seed.icon)
    em.persist(
      em.create(DictionaryEntry, {
        dictionary,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        value,
        label: seed.label.trim() || value,
        normalizedValue,
        color: color ?? null,
        icon: icon ?? null,
        createdAt: now,
        updatedAt: now,
      }),
    )
  }
  await em.flush()
}

export async function loadTicketQueueOptions(em: EntityManager, scope: SeedScope): Promise<TicketQueueOption[]> {
  const dictionary = await em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: TICKET_QUEUE_DICTIONARY_KEY,
    isActive: true,
    deletedAt: null,
  })
  if (!dictionary) {
    return DEFAULT_TICKET_QUEUES.map((seed) => ({ value: seed.value, label: seed.label, color: seed.color ?? null }))
  }
  const entries = await em.find(
    DictionaryEntry,
    { dictionary, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { position: 'asc', label: 'asc' } },
  )
  return entries.map((entry) => ({ value: entry.value, label: entry.label, color: entry.color ?? null }))
}
