import { describe, test, expect } from '@jest/globals'
import { createContainer, InjectionMode } from 'awilix'
import { getWorkflowFunction } from '@open-mercato/core/modules/workflows/lib/workflow-function-registry'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register } from '../di'
import {
  EXECUTE_APPROVED_PROPOSAL_DI_KEY,
  EXECUTE_APPROVED_PROPOSAL_FUNCTION,
  EXECUTE_APPROVED_PROPOSAL_LABEL_KEY,
} from '../lib/runtime/executeApprovedProposal'

/**
 * EXECUTE_FUNCTION resolves `workflowFunction:<name>` from the DI container, and the
 * Studio picker lists `registerWorkflowFunctions` descriptors. Both halves must exist
 * once the module's DI registrar has loaded.
 */
describe('execute_approved_proposal registration', () => {
  test('is a DI-resolvable workflow function and a picker entry with an i18n label', () => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC }) as unknown as AppContainer
    register(container)

    expect(EXECUTE_APPROVED_PROPOSAL_DI_KEY).toBe(`workflowFunction:${EXECUTE_APPROVED_PROPOSAL_FUNCTION}`)
    expect(typeof container.resolve(EXECUTE_APPROVED_PROPOSAL_DI_KEY)).toBe('function')
    expect(getWorkflowFunction(EXECUTE_APPROVED_PROPOSAL_FUNCTION)).toEqual({
      name: EXECUTE_APPROVED_PROPOSAL_FUNCTION,
      labelKey: EXECUTE_APPROVED_PROPOSAL_LABEL_KEY,
    })
  })
})
