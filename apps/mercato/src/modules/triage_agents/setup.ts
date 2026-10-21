import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { ensureTriageProcess } from './lib/processSeed'
import { SUPPORT_CONSULTANT_FEATURES, SUPPORT_CONSULTANT_ROLE } from './data/constants'
import { seedSupportConsultantRole } from './lib/demoConsultant'

const logger = createLogger('triage_agents').child({ component: 'setup' })

const TRIAGE_OPERATOR_FEATURES = [
  'triage_agents.view',
  'triage_agents.run',
  'agent_orchestrator.proposals.view',
  'agent_orchestrator.proposals.dispose',
  'agent_orchestrator.trace.view',
  'agent_orchestrator.processes.view',
  'agent_orchestrator.processes.run',
]

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['triage_agents.*'],
    admin: ['triage_agents.*', ...TRIAGE_OPERATOR_FEATURES],
    employee: TRIAGE_OPERATOR_FEATURES,
    [SUPPORT_CONSULTANT_ROLE]: [...SUPPORT_CONSULTANT_FEATURES],
  },

  async seedDefaults({ em, tenantId }) {
    await seedSupportConsultantRole(em as EntityManager, tenantId)
  },

  async seedExamples({ em, container, tenantId, organizationId }) {
    try {
      const result = await ensureTriageProcess(container as AwilixContainer, em as EntityManager, { tenantId, organizationId })
      logger.info('Seeded the ticket triage process', { ...result, tenantId, organizationId })
    } catch (err) {
      logger.warn('Skipping the ticket triage process seed', {
        tenantId,
        organizationId,
        error: err instanceof Error ? err.message : String(err),
      })
      reportError(err, { module: 'triage_agents', code: 'triage_agents.process_seed_failed' })
    }
  },
}

export default setup
