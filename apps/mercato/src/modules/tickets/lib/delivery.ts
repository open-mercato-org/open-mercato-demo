import { sendEmail, type SendEmailOptions } from '@open-mercato/shared/lib/email/send'
import { isEmailDeliveryConfigured, isEmailDeliveryDisabled } from '@open-mercato/shared/lib/email/config'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('tickets').child({ component: 'delivery' })

export const TICKETS_DELIVERY_ENV = 'OM_TICKETS_DELIVERY'

export type TicketDeliveryMode = 'live' | 'simulated'

export type TicketDeliveryResult = {
  status: 'sent' | 'simulated' | 'failed'
  sentAt: Date | null
  reason: 'simulated_mode' | 'delivery_disabled' | 'not_configured' | 'sent' | 'transport_error'
}

export type TicketDeliveryMessage = {
  to: string
  subject: string
  text: string
  tenantId: string
  organizationId: string
}

export type TicketDeliveryDeps = {
  env?: NodeJS.ProcessEnv
  send?: (options: SendEmailOptions) => Promise<void>
  isDisabled?: () => boolean
  isConfigured?: () => boolean
  now?: () => Date
}

export function resolveConfiguredDeliveryMode(env: NodeJS.ProcessEnv = process.env): TicketDeliveryMode {
  const raw = env[TICKETS_DELIVERY_ENV]?.trim().toLowerCase()
  return raw === 'simulated' ? 'simulated' : 'live'
}

export async function deliverTicketReply(
  message: TicketDeliveryMessage,
  deps: TicketDeliveryDeps = {},
): Promise<TicketDeliveryResult> {
  const now = deps.now ?? (() => new Date())
  if (resolveConfiguredDeliveryMode(deps.env ?? process.env) === 'simulated') {
    return { status: 'simulated', sentAt: now(), reason: 'simulated_mode' }
  }
  const isDisabled = deps.isDisabled ?? isEmailDeliveryDisabled
  if (isDisabled()) {
    return { status: 'simulated', sentAt: now(), reason: 'delivery_disabled' }
  }
  const isConfigured = deps.isConfigured ?? isEmailDeliveryConfigured
  if (!isConfigured()) {
    return { status: 'simulated', sentAt: now(), reason: 'not_configured' }
  }
  const send = deps.send ?? sendEmail
  try {
    await send({
      to: message.to,
      subject: message.subject,
      text: message.text,
      tenantId: message.tenantId,
      organizationId: message.organizationId,
    })
    return { status: 'sent', sentAt: now(), reason: 'sent' }
  } catch (err) {
    logger.warn('Ticket reply delivery failed', { err })
    return { status: 'failed', sentAt: null, reason: 'transport_error' }
  }
}
