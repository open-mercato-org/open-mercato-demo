import type { AwilixContainer } from 'awilix'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { seedReservationsDemo } from './lib/seeds'

const logger = createLogger('reservations').child({ component: 'setup' })

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['reservations.*'],
    admin: ['reservations.*'],
    employee: ['reservations.view', 'reservations.payment.record', 'reservations.refund.request'],
    support_consultant: ['reservations.view'],
  },

  async seedExamples({ container, tenantId, organizationId }) {
    const result = await seedReservationsDemo(container as AwilixContainer, { tenantId, organizationId })
    logger.info('Seeded reservations demo data', { ...result, tenantId, organizationId })
  },
}

export default setup
