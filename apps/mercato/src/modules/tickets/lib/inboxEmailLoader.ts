import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { InboxEmail } from '@open-mercato/core/modules/inbox_ops/data/entities'
import type { InboundEmail, IntakeScope } from './emailIntake'

const logger = createLogger('tickets').child({ component: 'inbox-email-loader' })

export async function loadInboundEmailFromInbox(
  em: EntityManager,
  emailId: string,
  scope: IntakeScope,
): Promise<InboundEmail | null> {
  let email: InboxEmail | null = null
  try {
    email = await findOneWithDecryption(
      em,
      InboxEmail,
      { id: emailId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      {},
      scope,
    )
  } catch (err) {
    logger.warn('Inbox email lookup failed; is the inbox_ops module enabled?', { err })
    return null
  }
  if (!email) return null
  return {
    fromEmail: email.forwardedByAddress,
    fromName: email.forwardedByName ?? null,
    toEmail: email.toAddress ?? null,
    subject: email.subject ?? '',
    bodyText: email.cleanedText ?? email.rawText ?? null,
    bodyHtml: email.rawHtml ?? null,
    messageId: email.messageId ?? null,
    inReplyTo: email.inReplyTo ?? null,
    references: Array.isArray(email.emailReferences) ? email.emailReferences : null,
    receivedAt: email.receivedAt ?? null,
    sourceInboxEmailId: email.id,
  }
}
