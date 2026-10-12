import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { loadInboundEmailFromInbox } from '../lib/inboxEmailLoader'
import { ingestInboundEmail } from '../lib/emailIntake'

const logger = createLogger('tickets').child({ component: 'inbox-email-to-ticket' })

export const metadata = {
  event: 'inbox_ops.email.received',
  persistent: true,
  id: 'tickets:inbox-email-to-ticket',
}

export const TICKETS_EMAIL_INTAKE_ENV = 'OM_TICKETS_EMAIL_INTAKE'

type Resolver = {
  resolve: <T = unknown>(name: string) => T
}

type SubscriberContext = Resolver & {
  container?: Resolver
  tenantId?: string | null
  organizationId?: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function resolveContainer(ctx: SubscriberContext): AwilixContainer {
  return (ctx.container ?? { resolve: ctx.resolve }) as AwilixContainer
}

export function isTicketEmailIntakeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanWithDefault(env[TICKETS_EMAIL_INTAKE_ENV], true)
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  if (!isTicketEmailIntakeEnabled()) return
  const tenantId = ctx.tenantId ?? null
  const organizationId = ctx.organizationId ?? null
  if (!tenantId || !organizationId) {
    logger.warn('Skipped inbound email without trusted scope', {
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
    })
    return
  }
  const record = toRecord(payload)
  const emailId = typeof record.emailId === 'string' && record.emailId.trim() ? record.emailId.trim() : null
  if (!emailId) {
    logger.warn('Skipped inbound email payload without emailId')
    return
  }
  const scope = { tenantId, organizationId }
  const container = resolveContainer(ctx)
  const em = container.resolve<EntityManager>('em').fork()
  const email = await loadInboundEmailFromInbox(em, emailId, scope)
  if (!email) {
    logger.warn('Inbound email not found in scope', { emailId })
    return
  }
  try {
    await ingestInboundEmail({ em, container, scope, email, channel: 'email' })
  } catch (err) {
    logger.warn('Failed to create ticket from inbound email', { err, emailId })
    throw err
  }
}
