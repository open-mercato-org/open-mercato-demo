const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const ensureRolesMock = jest.fn()
const ensureCustomRoleAclsMock = jest.fn()
const loadRoleSidebarPreferencesMock = jest.fn()
const saveRoleSidebarPreferenceMock = jest.fn()

jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))
jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({
  Role: class Role {},
  User: class User {},
  UserRole: class UserRole {},
}))
jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({ Organization: class Organization {} }))
jest.mock('@open-mercato/core/modules/auth/lib/setup-app', () => ({
  ensureRoles: (...args: unknown[]) => ensureRolesMock(...args),
  ensureCustomRoleAcls: (...args: unknown[]) => ensureCustomRoleAclsMock(...args),
}))
jest.mock('@open-mercato/core/modules/auth/lib/emailHash', () => ({ emailHashLookupValues: (email: string) => [`hash:${email}`] }))
jest.mock('@open-mercato/core/modules/auth/services/sidebarPreferencesService', () => ({
  loadRoleSidebarPreferences: (...args: unknown[]) => loadRoleSidebarPreferencesMock(...args),
  saveRoleSidebarPreference: (...args: unknown[]) => saveRoleSidebarPreferenceMock(...args),
}))
jest.mock('../lib/demo', () => ({
  buildSystemContext: (_container: unknown, scope: { organizationId: string }) => ({ systemActor: true, selectedOrganizationId: scope.organizationId }),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { getPasswordPolicy, validatePassword } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { SUPPORT_CONSULTANT_FEATURES, SUPPORT_CONSULTANT_HIDDEN_SIDEBAR_ITEMS, SUPPORT_CONSULTANT_ROLE } from '../data/constants'
import {
  ensureDemoConsultant,
  ensureSupportConsultantSidebar,
  generateDemoPassword,
} from '../lib/demoConsultant'
import setup from '../setup'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const PASSWORD = 'Valid-Passw0rd!'
const ROLE = { id: 'role-1', name: SUPPORT_CONSULTANT_ROLE }

function buildContainer() {
  const execute = jest.fn(async (commandId: string) =>
    commandId === 'auth.users.create' ? { result: { user: { id: 'user-new' } } } : { result: {} },
  )
  const invalidateTenantCache = jest.fn(async () => undefined)
  const em = { fork: () => em }
  const services: Record<string, unknown> = {
    em,
    commandBus: { execute },
    rbacService: { invalidateTenantCache },
  }
  return { container: { resolve: <T,>(name: string) => services[name] as T }, execute, invalidateTenantCache }
}

function mockLookups({ user = null, roles = [] as string[], organization = { id: 'org-1' } as unknown } = {}) {
  findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: { name: string }) => {
    if (entity.name === 'Organization') return organization
    if (entity.name === 'Role') return ROLE
    if (entity.name === 'User') return user
    return null
  })
  findWithDecryptionMock.mockResolvedValue(roles.map((name) => ({ role: { name } })))
}

beforeEach(() => {
  jest.clearAllMocks()
  loadRoleSidebarPreferencesMock.mockResolvedValue(new Map())
})

describe('support consultant role grants', () => {
  it('grants the consultant no AI-internal feature', () => {
    const granted = setup.defaultRoleFeatures?.[SUPPORT_CONSULTANT_ROLE] ?? []
    expect(granted).toEqual([...SUPPORT_CONSULTANT_FEATURES])
    for (const forbidden of ['agent_orchestrator.trace.view', 'agent_orchestrator.agents.view', 'agent_orchestrator.processes.view', 'triage_agents.run', 'triage_agents.manage']) {
      expect(granted).not.toContain(forbidden)
    }
  })
})

describe('ensureSupportConsultantSidebar', () => {
  it('merges the hidden Agents items into an existing role preference', async () => {
    loadRoleSidebarPreferencesMock.mockResolvedValue(
      new Map([['role-1', { version: 2, hiddenItems: ['/backend/audit', '/backend/other'], groupOrder: ['g'] }]]),
    )
    const changed = await ensureSupportConsultantSidebar({} as EntityManager, { roleId: 'role-1', tenantId: 'tenant-1' })
    expect(changed).toBe(true)
    const [, scope, settings] = saveRoleSidebarPreferenceMock.mock.calls[0]
    expect(scope).toMatchObject({ roleId: 'role-1', tenantId: 'tenant-1' })
    expect(settings.groupOrder).toEqual(['g'])
    expect(settings.hiddenItems).toEqual(['/backend/audit', '/backend/other', '/backend/caseload', '/backend/overview'])
  })

  it('is a no-op once every item is hidden', async () => {
    loadRoleSidebarPreferencesMock.mockResolvedValue(new Map([['role-1', { version: 2, hiddenItems: [...SUPPORT_CONSULTANT_HIDDEN_SIDEBAR_ITEMS] }]]))
    expect(await ensureSupportConsultantSidebar({} as EntityManager, { roleId: 'role-1', tenantId: 'tenant-1' })).toBe(false)
    expect(saveRoleSidebarPreferenceMock).not.toHaveBeenCalled()
  })
})

describe('ensureDemoConsultant', () => {
  it('creates the role, syncs its ACL, seeds the sidebar and creates the user through the auth command', async () => {
    mockLookups()
    const { container, execute, invalidateTenantCache } = buildContainer()
    const result = await ensureDemoConsultant(container, { ...SCOPE, email: 'consultant@acme.example', password: PASSWORD, modules: [] })
    expect(result).toEqual({ ok: true, userId: 'user-new', email: 'consultant@acme.example', created: true, roleId: 'role-1' })
    expect(ensureRolesMock).toHaveBeenCalledWith(expect.anything(), { tenantId: 'tenant-1', roleNames: [SUPPORT_CONSULTANT_ROLE] })
    expect(ensureCustomRoleAclsMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', [])
    expect(saveRoleSidebarPreferenceMock).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith('auth.users.create', {
      input: expect.objectContaining({ email: 'consultant@acme.example', password: PASSWORD, organizationId: 'org-1', roles: [SUPPORT_CONSULTANT_ROLE] }),
      ctx: expect.objectContaining({ systemActor: true }),
    })
    expect(invalidateTenantCache).toHaveBeenCalledWith('tenant-1')
  })

  it('updates the password of an existing consultant idempotently', async () => {
    mockLookups({ user: { id: 'user-1' }, roles: [SUPPORT_CONSULTANT_ROLE] })
    const { container, execute } = buildContainer()
    const result = await ensureDemoConsultant(container, { ...SCOPE, email: 'consultant@acme.example', password: PASSWORD, modules: [] })
    expect(result).toMatchObject({ ok: true, userId: 'user-1', created: false })
    expect(execute).toHaveBeenCalledWith('auth.users.update', {
      input: { id: 'user-1', password: PASSWORD, roles: [SUPPORT_CONSULTANT_ROLE], isConfirmed: true },
      ctx: expect.objectContaining({ systemActor: true }),
    })
  })

  it('refuses to take over a user holding other roles', async () => {
    mockLookups({ user: { id: 'user-1' }, roles: ['admin', SUPPORT_CONSULTANT_ROLE] })
    const { container, execute } = buildContainer()
    const result = await ensureDemoConsultant(container, { ...SCOPE, email: 'admin@acme.example', password: PASSWORD, modules: [] })
    expect(result).toEqual({ ok: false, reason: 'user_has_other_roles', detail: 'admin' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses an organization outside the tenant and a weak password', async () => {
    mockLookups({ organization: null })
    const { container } = buildContainer()
    expect(await ensureDemoConsultant(container, { ...SCOPE, email: 'c@acme.example', password: PASSWORD, modules: [] })).toEqual({
      ok: false,
      reason: 'organization_not_found',
    })
    expect(await ensureDemoConsultant(container, { ...SCOPE, email: 'c@acme.example', password: 'x', modules: [] })).toEqual({
      ok: false,
      reason: 'password_policy',
    })
    expect(ensureRolesMock).not.toHaveBeenCalled()
  })
})

describe('generateDemoPassword', () => {
  it('produces distinct passwords that satisfy the policy', () => {
    const first = generateDemoPassword()
    const second = generateDemoPassword()
    expect(first).not.toBe(second)
    expect(validatePassword(first, getPasswordPolicy()).ok).toBe(true)
  })
})
