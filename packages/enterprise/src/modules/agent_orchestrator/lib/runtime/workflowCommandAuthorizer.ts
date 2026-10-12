import type { ExecuteProposalAuthorization } from './executeProposal'

type ResolvingContainer = { resolve: <T>(name: string) => T }

type RbacFeatureResolver = {
  userHasAllFeatures: (
    userId: string,
    required: string[],
    opts: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

export type WorkflowCommandAuthorizerScope = {
  tenantId: string
  organizationId: string
  userId: string | null
}

/**
 * The `UPDATE_ENTITY` gate (`workflows/lib/activity-executor.ts`), applied per command
 * an approved proposal is about to run:
 *
 *   1. the code declares the command workflow-safe (`registerWorkflowSafeCommands`);
 *   2. this tenant switched it on (Workflow settings, grandfathered default when unset);
 *   3. the acting workflow user holds the command's declared features.
 *
 * Fails closed at every step: no acting user, an unreachable `workflows` module or an
 * unresolvable `rbacService` all deny. `workflows` is an optional peer, so it is reached
 * through a dynamic import, exactly as `actionVocabulary.ts` reaches the catalogue.
 */
export function createWorkflowCommandAuthorizer(
  container: ResolvingContainer,
  scope: WorkflowCommandAuthorizerScope,
): (commandId: string) => Promise<ExecuteProposalAuthorization> {
  let policyPromise: Promise<
    import('@open-mercato/core/modules/workflows/lib/workflow-command-enablement').WorkflowCommandEnablementPolicy
  > | null = null

  return async (commandId: string): Promise<ExecuteProposalAuthorization> => {
    const actorUserId = scope.userId?.trim() ?? ''
    if (!actorUserId) return { allowed: false, reason: 'no authenticated workflow user to authorize the command' }

    let modules: [
      typeof import('@open-mercato/core/modules/workflows/lib/workflow-safe-commands'),
      typeof import('@open-mercato/core/modules/workflows/lib/workflow-command-enablement'),
      typeof import('@open-mercato/core/modules/workflows/lib/workflow-command-settings'),
    ]
    try {
      modules = await Promise.all([
        import('@open-mercato/core/modules/workflows/lib/workflow-safe-commands'),
        import('@open-mercato/core/modules/workflows/lib/workflow-command-enablement'),
        import('@open-mercato/core/modules/workflows/lib/workflow-command-settings'),
      ])
    } catch {
      return { allowed: false, reason: 'workflow command catalogue unavailable' }
    }
    const [safeCommands, enablement, settings] = modules

    const definition = safeCommands.getWorkflowSafeCommand(commandId)
    if (!definition) return { allowed: false, reason: `command "${commandId}" is not workflow-safe` }

    policyPromise ??= settings.resolveWorkflowCommandPolicyForContainer(container, scope.tenantId)
    const policy = await policyPromise
    if (!enablement.isWorkflowCommandEnabled(definition, policy)) {
      return { allowed: false, reason: `command "${commandId}" is not enabled for this tenant` }
    }

    let authorized = false
    try {
      const rbac = container.resolve<RbacFeatureResolver | undefined>('rbacService')
      if (rbac?.userHasAllFeatures) {
        authorized = await rbac.userHasAllFeatures(actorUserId, [...definition.requiredFeatures], {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
      }
    } catch {
      authorized = false
    }
    if (!authorized) return { allowed: false, reason: `command "${commandId}" is not authorized for the workflow user` }
    return { allowed: true }
  }
}
