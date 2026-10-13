/**
 * The decision behind `POST /executions/:id/rerun` (spec §C2) — PURE.
 *
 * A re-run starts a NEW execution of the same process with the original trigger
 * context. It never replays effectors, so the only way to double-act is to leave
 * the original's open decision alive next to a fresh one; that is why a pending
 * proposal blocks the re-run unless the caller explicitly supersedes it.
 */

export const RERUN_SUPERSEDE_REASON = 'superseded_by_rerun'

export type RerunGuardInput = {
  hasProcessDefinition: boolean
  manualTriggerDeclared: boolean
  manualTriggerFeaturesGranted: boolean
  pendingProposalIds: string[]
  supersede: boolean
  canDisposeProposals: boolean
}

export type RerunGuardDecision =
  | { allowed: true; supersedeProposalIds: string[] }
  | {
      allowed: false
      status: 403 | 409 | 422
      code: 'no_process_definition' | 'no_manual_trigger' | 'missing_trigger_features' | 'pending_proposal' | 'missing_dispose_feature'
      pendingProposalIds?: string[]
    }

export function evaluateRerunGuard(input: RerunGuardInput): RerunGuardDecision {
  if (!input.hasProcessDefinition) return { allowed: false, status: 422, code: 'no_process_definition' }
  if (!input.manualTriggerDeclared) return { allowed: false, status: 403, code: 'no_manual_trigger' }
  if (!input.manualTriggerFeaturesGranted) return { allowed: false, status: 403, code: 'missing_trigger_features' }
  if (input.pendingProposalIds.length === 0) return { allowed: true, supersedeProposalIds: [] }
  if (!input.supersede) {
    return { allowed: false, status: 409, code: 'pending_proposal', pendingProposalIds: input.pendingProposalIds }
  }
  if (!input.canDisposeProposals) return { allowed: false, status: 403, code: 'missing_dispose_feature' }
  return { allowed: true, supersedeProposalIds: input.pendingProposalIds }
}
