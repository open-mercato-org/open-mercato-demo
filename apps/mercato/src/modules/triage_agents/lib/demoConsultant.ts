import { randomBytes } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { Module } from '@open-mercato/shared/modules/registry'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getPasswordPolicy, validatePassword } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { SIDEBAR_PREFERENCES_VERSION } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import { Role, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { ensureCustomRoleAcls, ensureRoles } from '@open-mercato/core/modules/auth/lib/setup-app'
import { emailHashLookupValues } from '@open-mercato/core/modules/auth/lib/emailHash'
import {
  loadRoleSidebarPreferences,
  saveRoleSidebarPreference,
} from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'
import {
  SUPPORT_CONSULTANT_HIDDEN_SIDEBAR_ITEMS,
  SUPPORT_CONSULTANT_ROLE,
} from '../data/constants'
import { buildSystemContext } from './demo'
import type { TriageScope } from './kbArticles'

type ResolverLike = { resolve: <T = unknown>(name: string) => T }

const logger = createLogger('triage_agents').child({ component: 'demo-consultant' })

const SIDEBAR_LOCALE = 'en'
const CONSULTANT_DISPLAY_NAME = 'Support Consultant'

/** Creates the tenant's `support_consultant` role when missing; returns its id. */
export async function ensureSupportConsultantRole(em: EntityManager, tenantId: string): Promise<string> {
  await ensureRoles(em, { tenantId, roleNames: [SUPPORT_CONSULTANT_ROLE] })
  const role = await findOneWithDecryption(
    em,
    Role,
    { name: SUPPORT_CONSULTANT_ROLE, tenantId, deletedAt: null },
    {},
    { tenantId, organizationId: null },
  )
  if (!role) throw new Error(`[internal] Role ${SUPPORT_CONSULTANT_ROLE} could not be created for tenant ${tenantId}`)
  return String(role.id)
}

/**
 * Hides the AI-operator Agents pages (Caseload, Overview, Audit — reachable through
 * `agent_orchestrator.proposals.view`) from the consultant's sidebar through a role
 * sidebar preference, merged into whatever the tenant already configured.
 */
export async function ensureSupportConsultantSidebar(
  em: EntityManager,
  scope: { roleId: string; tenantId: string },
): Promise<boolean> {
  const existing = (await loadRoleSidebarPreferences(em, { roleIds: [scope.roleId], tenantId: scope.tenantId })).get(scope.roleId)
  const hidden = existing?.hiddenItems ?? []
  const missing = SUPPORT_CONSULTANT_HIDDEN_SIDEBAR_ITEMS.filter((item) => !hidden.includes(item))
  if (missing.length === 0) return false
  await saveRoleSidebarPreference(
    em,
    { roleId: scope.roleId, tenantId: scope.tenantId, locale: SIDEBAR_LOCALE },
    {
      ...(existing ?? {}),
      version: existing?.version ?? SIDEBAR_PREFERENCES_VERSION,
      hiddenItems: [...hidden, ...missing],
    },
  )
  return true
}

/** Role + sidebar preference — idempotent, safe for `seedDefaults` and the demo CLI. */
export async function seedSupportConsultantRole(em: EntityManager, tenantId: string): Promise<string> {
  const roleId = await ensureSupportConsultantRole(em, tenantId)
  await ensureSupportConsultantSidebar(em, { roleId, tenantId })
  return roleId
}

export function generateDemoPassword(): string {
  const policy = getPasswordPolicy()
  for (;;) {
    const candidate = `${randomBytes(Math.max(18, policy.minLength)).toString('base64url')}-A7`
    if (validatePassword(candidate, policy).ok) return candidate
  }
}

export type DemoConsultantInput = TriageScope & {
  email: string
  password: string
  modules: Module[]
}

export type DemoConsultantResult =
  | { ok: true; userId: string; email: string; created: boolean; roleId: string }
  | { ok: false; reason: 'organization_not_found' | 'user_has_other_roles' | 'password_policy'; detail?: string }

async function findTenantUser(em: EntityManager, email: string, tenantId: string): Promise<User | null> {
  return findOneWithDecryption(
    em,
    User,
    { $or: [{ email }, { emailHash: { $in: emailHashLookupValues(email) } }], tenantId, deletedAt: null },
    {},
    { tenantId, organizationId: null },
  )
}

async function loadRoleNames(em: EntityManager, userId: string, tenantId: string): Promise<string[]> {
  const links = await findWithDecryption(
    em,
    UserRole,
    { user: userId, deletedAt: null },
    { populate: ['role'] },
    { tenantId, organizationId: null },
  )
  return Array.from(new Set(links.map((link) => link.role?.name ?? '').filter((name) => name.length > 0)))
}

/**
 * Idempotently provisions the demo helpdesk consultant: the role (with the ACL every
 * module declares for it in `defaultRoleFeatures`), the sidebar preference and the
 * user. The user goes through the auth module's own `auth.users.create|update`
 * commands, so hashing, audit and events stay the auth module's. An existing user
 * holding any other role is refused rather than demoted.
 */
export async function ensureDemoConsultant(
  container: ResolverLike,
  input: DemoConsultantInput,
): Promise<DemoConsultantResult> {
  if (!validatePassword(input.password).ok) return { ok: false, reason: 'password_policy' }
  const em = container.resolve<EntityManager>('em').fork()
  const organization = await findOneWithDecryption(
    em,
    Organization,
    { id: input.organizationId, tenant: input.tenantId, deletedAt: null },
    {},
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  if (!organization) return { ok: false, reason: 'organization_not_found' }

  const roleId = await seedSupportConsultantRole(em, input.tenantId)
  await ensureCustomRoleAcls(em, input.tenantId, input.modules)

  const commandBus = container.resolve<CommandBus>('commandBus')
  const ctx = buildSystemContext(container, input)
  const existing = await findTenantUser(em, input.email, input.tenantId)
  let userId: string
  if (existing) {
    const roles = await loadRoleNames(em, String(existing.id), input.tenantId)
    const foreign = roles.filter((name) => name !== SUPPORT_CONSULTANT_ROLE)
    if (foreign.length > 0) return { ok: false, reason: 'user_has_other_roles', detail: foreign.join(', ') }
    await commandBus.execute('auth.users.update', {
      input: { id: String(existing.id), password: input.password, roles: [SUPPORT_CONSULTANT_ROLE], isConfirmed: true },
      ctx,
    })
    userId = String(existing.id)
  } else {
    const { result } = await commandBus.execute<Record<string, unknown>, { user: { id: string } }>('auth.users.create', {
      input: {
        email: input.email,
        name: CONSULTANT_DISPLAY_NAME,
        password: input.password,
        organizationId: input.organizationId,
        roles: [SUPPORT_CONSULTANT_ROLE],
      },
      ctx,
    })
    userId = String(result.user.id)
  }

  await invalidateTenantAcl(container, input.tenantId)
  return { ok: true, userId, email: input.email, created: !existing, roleId }
}

async function invalidateTenantAcl(container: ResolverLike, tenantId: string): Promise<void> {
  try {
    const rbac = container.resolve<{ invalidateTenantCache?: (tenantId: string) => Promise<void> }>('rbacService')
    await rbac.invalidateTenantCache?.(tenantId)
  } catch (err) {
    logger.warn('Could not invalidate the tenant ACL cache', { tenantId, err })
    reportError(err, { module: 'triage_agents', code: 'triage_agents.demo_consultant_acl_cache' })
  }
}
