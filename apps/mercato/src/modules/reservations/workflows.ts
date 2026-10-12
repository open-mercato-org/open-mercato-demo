import { createWorkflowsModuleConfig } from '@open-mercato/shared/modules/workflows'
import { registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'

registerWorkflowSafeCommands([
  {
    commandId: 'reservations.refund.request',
    requiredFeatures: ['reservations.refund.request'],
    labelKey: 'reservations.workflows.commands.refund.request',
  },
])

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'reservations',
  workflows: [],
})

export default workflowsConfig
