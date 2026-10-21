import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { TicketNumberGenerator } from './lib/numberGenerator'
import { seedTicketQueues } from './lib/dictionaries'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['tickets.*'],
    admin: ['tickets.*'],
    employee: ['tickets.view', 'tickets.manage', 'tickets.classify', 'tickets.reply'],
    support_consultant: ['tickets.view', 'tickets.manage', 'tickets.classify', 'tickets.reply'],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    await new TicketNumberGenerator(em as EntityManager).ensureSequence({ tenantId, organizationId })
  },

  async seedDefaults({ em, tenantId, organizationId }) {
    await seedTicketQueues(em as EntityManager, { tenantId, organizationId })
  },
}

export default setup
