import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedKnowledgeBase } from './lib/seeds'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['knowledge_articles.*'],
    admin: ['knowledge_articles.*'],
    employee: ['knowledge_articles.view'],
  },

  async seedExamples({ em, tenantId, organizationId }) {
    await seedKnowledgeBase(em, { tenantId, organizationId })
  },
}

export default setup
