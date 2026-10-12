import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerWorkflowFunctions } from '@open-mercato/core/modules/workflows/lib/workflow-function-registry'
import { COMPUTE_PRIORITY_FUNCTION, RECORD_STAGE_FUNCTION, ROUTE_FUNCTION } from './data/constants'
import { createComputePriorityFunction, createRecordStageFunction, createRouteFunction } from './lib/workflowFunctions'
import { registerTriageFixtureDirs } from './lib/fixtures'

export const workflowFunctionKey = (name: string): string => `workflowFunction:${name}`

registerWorkflowFunctions([
  { name: COMPUTE_PRIORITY_FUNCTION, labelKey: 'triage_agents.workflowFunctions.computePriority' },
  { name: ROUTE_FUNCTION, labelKey: 'triage_agents.workflowFunctions.route' },
  { name: RECORD_STAGE_FUNCTION, labelKey: 'triage_agents.workflowFunctions.recordStage' },
])

registerTriageFixtureDirs()

export function register(container: AppContainer) {
  container.register({
    [workflowFunctionKey(COMPUTE_PRIORITY_FUNCTION)]: asValue(createComputePriorityFunction(container)),
    [workflowFunctionKey(ROUTE_FUNCTION)]: asValue(createRouteFunction(container)),
    [workflowFunctionKey(RECORD_STAGE_FUNCTION)]: asValue(createRecordStageFunction(container)),
  })
}
