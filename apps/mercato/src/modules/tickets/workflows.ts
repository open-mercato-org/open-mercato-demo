import { createWorkflowsModuleConfig } from '@open-mercato/shared/modules/workflows'
import {
  registerWorkflowSafeCommands,
  type WorkflowSafeCommandDefinition,
} from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'

export const ticketsWorkflowSafeCommands: WorkflowSafeCommandDefinition[] = [
  {
    commandId: 'tickets.ticket.classify',
    requiredFeatures: ['tickets.classify'],
    labelKey: 'tickets.workflows.commands.classify',
  },
  {
    commandId: 'tickets.ticket.flag_manual_review',
    requiredFeatures: ['tickets.classify'],
    labelKey: 'tickets.workflows.commands.flagManualReview',
  },
  {
    commandId: 'tickets.ticket.transition',
    requiredFeatures: ['tickets.manage'],
    labelKey: 'tickets.workflows.commands.transition',
  },
  {
    commandId: 'tickets.reply_draft.save',
    requiredFeatures: ['tickets.reply'],
    labelKey: 'tickets.workflows.commands.saveReplyDraft',
  },
  {
    commandId: 'tickets.reply.send',
    requiredFeatures: ['tickets.reply'],
    labelKey: 'tickets.workflows.commands.sendReply',
  },
]

registerWorkflowSafeCommands(ticketsWorkflowSafeCommands)

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'tickets',
  workflows: [],
})

export default workflowsConfig
