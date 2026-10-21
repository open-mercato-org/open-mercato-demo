import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Ticket, TicketArticle } from '../data/entities'
import type { InboundArticleInput, TicketCreateInput } from '../data/validators'
import { matchThread, normalizeMessageId, type ThreadMatch } from './threadMatcher'
import { htmlToPlainText } from './text'

export type IntakeScope = {
  tenantId: string
  organizationId: string
}

export type InboundEmail = {
  fromEmail: string
  fromName?: string | null
  toEmail?: string | null
  subject: string
  bodyText?: string | null
  bodyHtml?: string | null
  messageId?: string | null
  inReplyTo?: string | null
  references?: readonly string[] | null
  receivedAt?: Date | null
  sourceInboxEmailId?: string | null
}

export type IntakeResult = {
  ticketId: string
  number: string
  articleId: string | null
  created: boolean
  duplicate: boolean
  match: ThreadMatch['kind']
}

export type IngestInboundEmailArgs = {
  em: EntityManager
  container: AwilixContainer
  scope: IntakeScope
  email: InboundEmail
  channel?: 'email' | 'api'
  ctx?: CommandRuntimeContext
}

const UNIQUE_VIOLATION_CODE = '23505'

export function isUniqueViolation(err: unknown): boolean {
  const visited = new Set<unknown>()
  const inspect = (value: unknown, depth: number): boolean => {
    if (depth > 4 || !value || typeof value !== 'object' || visited.has(value)) return false
    visited.add(value)
    const record = value as Record<string, unknown>
    if (record.code === UNIQUE_VIOLATION_CODE) return true
    if (typeof record.name === 'string' && record.name === 'UniqueConstraintViolationException') return true
    return inspect(record.cause, depth + 1) || inspect(record.previous, depth + 1) || inspect(record.originalError, depth + 1)
  }
  return inspect(err, 0)
}

export function buildIntakeCommandContext(container: AwilixContainer, scope: IntakeScope): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    syncOrigin: 'tickets.email_intake',
    systemActor: true,
  }
}

function resolveBody(email: InboundEmail): string {
  const text = email.bodyText?.trim()
  if (text) return text
  const html = email.bodyHtml?.trim()
  if (html) return htmlToPlainText(html)
  return ''
}

async function findExistingArticle(
  em: EntityManager,
  scope: IntakeScope,
  email: InboundEmail,
): Promise<TicketArticle | null> {
  const messageId = normalizeMessageId(email.messageId)
  if (messageId) {
    const byMessage = await findOneWithDecryption(
      em,
      TicketArticle,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, messageId },
      {},
      scope,
    )
    if (byMessage) return byMessage
  }
  if (email.sourceInboxEmailId) {
    return findOneWithDecryption(
      em,
      TicketArticle,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, sourceInboxEmailId: email.sourceInboxEmailId },
      {},
      scope,
    )
  }
  return null
}

async function loadTicketById(em: EntityManager, scope: IntakeScope, ticketId: string): Promise<Ticket | null> {
  return findOneWithDecryption(
    em,
    Ticket,
    { id: ticketId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
}

function buildLookups(em: EntityManager, scope: IntakeScope) {
  return {
    findTicketIdByMessageIds: async (messageIds: string[]): Promise<string | null> => {
      const articles = await findWithDecryption(
        em,
        TicketArticle,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, messageId: { $in: messageIds }, deletedAt: null },
        { orderBy: { createdAt: 'desc' }, limit: 1 },
        scope,
      )
      return articles[0]?.ticketId ?? null
    },
    findTicketIdByNumber: async (number: string): Promise<string | null> => {
      const ticket = await findOneWithDecryption(
        em,
        Ticket,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, number, deletedAt: null },
        {},
        scope,
      )
      return ticket?.id ?? null
    },
  }
}

function toArticleInput(email: InboundEmail, body: string): InboundArticleInput {
  return {
    fromEmail: email.fromEmail.trim().toLowerCase(),
    fromName: email.fromName ?? null,
    toEmail: email.toEmail ?? null,
    subject: email.subject,
    bodyText: body,
    bodyHtml: email.bodyHtml ?? null,
    messageId: normalizeMessageId(email.messageId),
    inReplyTo: normalizeMessageId(email.inReplyTo),
    sourceInboxEmailId: email.sourceInboxEmailId ?? null,
    receivedAt: email.receivedAt ?? null,
  }
}

async function resultForExisting(
  em: EntityManager,
  scope: IntakeScope,
  article: TicketArticle,
): Promise<IntakeResult | null> {
  const ticket = await findOneWithDecryption(
    em,
    Ticket,
    { id: article.ticketId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )
  if (!ticket) return null
  return { ticketId: ticket.id, number: ticket.number, articleId: article.id, created: false, duplicate: true, match: 'message' }
}

export async function ingestInboundEmail(args: IngestInboundEmailArgs): Promise<IntakeResult> {
  const { em, container, scope, email } = args
  const existing = await findExistingArticle(em, scope, email)
  if (existing) {
    const result = await resultForExisting(em, scope, existing)
    if (result) return result
  }
  const commandBus = container.resolve<CommandBus>('commandBus')
  const commandCtx = args.ctx ?? buildIntakeCommandContext(container, scope)
  const body = resolveBody(email)
  const article = toArticleInput(email, body)
  const match = await matchThread(
    { subject: email.subject, inReplyTo: email.inReplyTo ?? null, references: email.references ?? null },
    buildLookups(em, scope),
  )
  try {
    if (match.ticketId) {
      const matched = await loadTicketById(em, scope, match.ticketId)
      if (matched && matched.status !== 'closed') {
        const { result } = await commandBus.execute<unknown, { ticketId: string; articleId: string }>(
          'tickets.article.receive',
          {
            input: { tenantId: scope.tenantId, organizationId: scope.organizationId, ticketId: matched.id, article },
            ctx: commandCtx,
          },
        )
        return {
          ticketId: matched.id,
          number: matched.number,
          articleId: result?.articleId ?? null,
          created: false,
          duplicate: false,
          match: match.kind,
        }
      }
    }
    const createInput: TicketCreateInput = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      subject: email.subject.trim() || article.fromEmail,
      channel: args.channel ?? 'email',
      requesterEmail: article.fromEmail,
      requesterName: email.fromName ?? null,
      initialArticle: article,
    }
    const { result } = await commandBus.execute<TicketCreateInput, { ticketId: string; number: string; articleId: string | null }>(
      'tickets.ticket.create',
      { input: createInput, ctx: commandCtx },
    )
    if (!result?.ticketId) throw new Error('[internal] tickets intake create returned no ticket id')
    return {
      ticketId: result.ticketId,
      number: result.number,
      articleId: result.articleId,
      created: true,
      duplicate: false,
      match: 'new',
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await findExistingArticle(em.fork(), scope, email)
      if (winner) {
        const result = await resultForExisting(em.fork(), scope, winner)
        if (result) return result
      }
    }
    throw err
  }
}
