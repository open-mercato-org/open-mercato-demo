import type { EntityManager } from '@mikro-orm/postgresql'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import {
  getTicketInputSchema,
  listTicketsInputSchema,
  listTicketsForAgent,
  readTicketForAgent,
  type AgentScope,
  type AgentTicketDetail,
  type AgentTicketSummary,
} from './lib/agentReads'

export function requireTicketToolScope(context: Pick<McpToolContext, 'tenantId' | 'organizationId'>): AgentScope {
  const tenantId = typeof context.tenantId === 'string' ? context.tenantId.trim() : ''
  const organizationId = typeof context.organizationId === 'string' ? context.organizationId.trim() : ''
  if (!tenantId || !organizationId) {
    throw new Error('[internal] tickets AI tools require a tenant- and organization-scoped context')
  }
  return { tenantId, organizationId }
}

export type GetTicketToolResult = { found: false; ticketId: string } | ({ found: true } & AgentTicketDetail)

export type ListTicketsToolResult = { items: AgentTicketSummary[] }

const getTicketTool: AiToolDefinition = defineAiTool<unknown, GetTicketToolResult>({
  name: 'tickets.get_ticket',
  displayName: 'Tickets — get ticket',
  description:
    'Return one helpdesk ticket (status, priority, classification, requester) plus its most recent articles, oldest first. Article bodies are trimmed to 4000 characters and quoted email history is stripped. Read-only.',
  tags: ['read', 'tickets'],
  isMutation: false,
  requiredFeatures: ['tickets.view'],
  inputSchema: getTicketInputSchema,
  async handler(input, context) {
    const scope = requireTicketToolScope(context)
    const parsed = getTicketInputSchema.parse(input)
    const em = context.container.resolve<EntityManager>('em').fork()
    const detail = await readTicketForAgent(em, scope, parsed)
    if (!detail) return { found: false, ticketId: parsed.ticketId }
    return { found: true, ...detail }
  },
})

const listTicketsTool: AiToolDefinition = defineAiTool<unknown, ListTicketsToolResult>({
  name: 'tickets.list_tickets',
  displayName: 'Tickets — list requester tickets',
  description:
    'List the most recent tickets (max 10) of one requester, identified by customer person id and/or requester email, optionally filtered by status. Use it for the contact history of a customer. Read-only.',
  tags: ['read', 'tickets'],
  isMutation: false,
  requiredFeatures: ['tickets.view'],
  inputSchema: listTicketsInputSchema,
  async handler(input, context) {
    const scope = requireTicketToolScope(context)
    const parsed = listTicketsInputSchema.parse(input)
    const em = context.container.resolve<EntityManager>('em').fork()
    return { items: await listTicketsForAgent(em, scope, parsed) }
  },
})

export const aiTools: AiToolDefinition[] = [getTicketTool, listTicketsTool]

export default aiTools
