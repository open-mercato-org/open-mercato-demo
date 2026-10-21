import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { CUSTOMER_ENTITY_ID } from '../data/constants'

export type CustomerPersonContact = {
  id: string
  displayName: string | null
  primaryEmail: string | null
}

type ResolverLike = {
  resolve: <T = unknown>(name: string) => T
}

type CustomerRow = {
  id?: unknown
  display_name?: unknown
  primary_email?: unknown
  kind?: unknown
}

const PERSON_PAGE_SIZE = 100
const PERSON_SCAN_MAX_PAGES = 20

export function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function toContact(row: CustomerRow): CustomerPersonContact | null {
  const id = readString(row.id)
  if (!id) return null
  return {
    id,
    displayName: readString(row.display_name),
    primaryEmail: normalizeEmail(readString(row.primary_email)),
  }
}

function tryResolveQueryEngine(container: ResolverLike): QueryEngine | null {
  try {
    return container.resolve<QueryEngine>('queryEngine')
  } catch {
    return null
  }
}

export async function loadCustomerPersonContact(
  container: ResolverLike,
  scope: { tenantId: string; organizationId: string },
  personId: string,
): Promise<CustomerPersonContact | null> {
  const queryEngine = tryResolveQueryEngine(container)
  if (!queryEngine) return null
  const result = await queryEngine.query<CustomerRow>(CUSTOMER_ENTITY_ID, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    filters: { id: { $eq: personId }, kind: { $eq: 'person' } },
    fields: ['id', 'display_name', 'primary_email', 'kind'],
    page: { page: 1, pageSize: 1 },
  })
  const row = Array.isArray(result.items) ? result.items[0] : undefined
  return row ? toContact(row) : null
}

export async function findCustomerPersonByEmail(
  container: ResolverLike,
  scope: { tenantId: string; organizationId: string },
  email: string,
): Promise<CustomerPersonContact | null> {
  const target = normalizeEmail(email)
  if (!target) return null
  const queryEngine = tryResolveQueryEngine(container)
  if (!queryEngine) return null
  for (let page = 1; page <= PERSON_SCAN_MAX_PAGES; page += 1) {
    const result = await queryEngine.query<CustomerRow>(CUSTOMER_ENTITY_ID, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      filters: { kind: { $eq: 'person' } },
      fields: ['id', 'display_name', 'primary_email', 'kind'],
      page: { page, pageSize: PERSON_PAGE_SIZE },
    })
    const items = Array.isArray(result.items) ? result.items : []
    for (const row of items) {
      const contact = toContact(row)
      if (contact && contact.primaryEmail === target) return contact
    }
    if (items.length < PERSON_PAGE_SIZE) break
  }
  return null
}
