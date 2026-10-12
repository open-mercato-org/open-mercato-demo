import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { ProposedAction } from '../../data/validators'
import {
  isEffectWithinVocabulary,
  loadActionVocabulary,
  type ActionVocabulary,
} from './actionVocabulary'

export type ExecuteProposalAuthorization = { allowed: true } | { allowed: false; reason: string }

export type ExecuteProposalCtx = {
  commandBus: CommandBus
  commandCtx: CommandRuntimeContext
  /**
   * Maps a proposed action `type` to the OM command id that effects it. Callers
   * (area 03 disposition) supply this so each action runs through the audited
   * command runner (audit/events/index fire). Actions whose type has no mapping
   * are returned as `skipped`.
   */
  actionCommandMap: Record<string, string>
  /**
   * Pre-resolved action vocabulary. Callers running many proposals may load it once;
   * omitted, it is read per call. Never widen it — it is the catalogue, not a grant.
   */
  vocabulary?: ActionVocabulary
  /**
   * The proposing agent's narrowed vocabulary (`AgentRegistryEntry.allowedActions`).
   * Omitted/null means the agent declared no narrowing and is bounded by the catalogue
   * alone; an EMPTY list denies every action, which is what a declaration whose entries
   * were all dropped at registration must mean.
   */
  allowedActions?: readonly string[] | null
  /**
   * Stop at the first action that does not succeed. Every action is gated (mapping,
   * vocabulary, authorization) BEFORE any of them runs, so a plan holding one blocked
   * action executes nothing; after a command error the remaining actions are reported
   * `skipped`. Default `false` keeps the historical continue-on-error loop.
   */
  stopOnFailure?: boolean
  /**
   * Per-command authorization gate (tenant enablement + the acting user's features),
   * equivalent to the one `UPDATE_ENTITY` applies. Omitted, only the vocabulary bounds
   * the effect — what every pre-existing caller relies on. A gate that throws denies.
   */
  authorizeCommand?: (commandId: string) => Promise<ExecuteProposalAuthorization>
}

export type ExecuteProposalActionResult =
  | { type: string; status: 'ok'; result: unknown }
  | { type: string; status: 'skipped'; reason: string }
  | { type: string; status: 'error'; error: string }

type GateOutcome =
  | { kind: 'runnable'; action: ProposedAction; commandId: string }
  | { kind: 'blocked'; result: ExecuteProposalActionResult }

export const NOT_RUN_AFTER_BLOCK_REASON = 'not executed: another action in the plan was blocked'
export const NOT_RUN_AFTER_FAILURE_REASON = 'not executed: a preceding action failed'

async function gateAction(
  action: ProposedAction,
  vocabulary: ActionVocabulary,
  ctx: ExecuteProposalCtx,
): Promise<GateOutcome> {
  const commandId = ctx.actionCommandMap[action.type]
  if (!commandId) {
    return {
      kind: 'blocked',
      result: { type: action.type, status: 'skipped', reason: `no command mapped for action type "${action.type}"` },
    }
  }
  // Server-side vocabulary re-check, immediately before the effect. The proposal may
  // have been made under a catalogue the tenant has since narrowed; a stale approval
  // must not carry an effect the platform no longer declares runnable.
  if (!isEffectWithinVocabulary(vocabulary, action.type, commandId, ctx.allowedActions)) {
    return {
      kind: 'blocked',
      result: {
        type: action.type,
        status: 'skipped',
        reason: `action type "${action.type}" is outside the effective action vocabulary`,
      },
    }
  }
  if (ctx.authorizeCommand) {
    let authorization: ExecuteProposalAuthorization
    try {
      authorization = await ctx.authorizeCommand(commandId)
    } catch (err) {
      authorization = { allowed: false, reason: err instanceof Error ? err.message : String(err) }
    }
    if (!authorization.allowed) {
      return { kind: 'blocked', result: { type: action.type, status: 'skipped', reason: authorization.reason } }
    }
  }
  return { kind: 'runnable', action, commandId }
}

async function runAction(
  action: ProposedAction,
  commandId: string,
  ctx: ExecuteProposalCtx,
): Promise<ExecuteProposalActionResult> {
  try {
    const { result } = await ctx.commandBus.execute(commandId, {
      input: action.payload,
      ctx: ctx.commandCtx,
    })
    return { type: action.type, status: 'ok', result }
  } catch (err) {
    return { type: action.type, status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Run a proposal's actions through OM Commands, audited, in the order proposed.
 * Callers run this only AFTER disposition; the playground never auto-executes.
 * The production caller is the `agent_orchestrator.execute_approved_proposal`
 * workflow function (`executeApprovedProposal.ts`), which runs with
 * `stopOnFailure` and the `UPDATE_ENTITY`-equivalent `authorizeCommand` gate.
 */
export async function executeProposal(
  actions: ProposedAction[],
  ctx: ExecuteProposalCtx,
): Promise<ExecuteProposalActionResult[]> {
  const vocabulary = ctx.vocabulary ?? (await loadActionVocabulary())

  if (!ctx.stopOnFailure) {
    const results: ExecuteProposalActionResult[] = []
    for (const action of actions) {
      const gate = await gateAction(action, vocabulary, ctx)
      results.push(gate.kind === 'blocked' ? gate.result : await runAction(gate.action, gate.commandId, ctx))
    }
    return results
  }

  const gates: GateOutcome[] = []
  for (const action of actions) gates.push(await gateAction(action, vocabulary, ctx))
  if (gates.some((gate) => gate.kind === 'blocked')) {
    return gates.map((gate) =>
      gate.kind === 'blocked'
        ? gate.result
        : { type: gate.action.type, status: 'skipped', reason: NOT_RUN_AFTER_BLOCK_REASON },
    )
  }

  const results: ExecuteProposalActionResult[] = []
  let failed = false
  for (const gate of gates) {
    if (gate.kind === 'blocked') continue
    if (failed) {
      results.push({ type: gate.action.type, status: 'skipped', reason: NOT_RUN_AFTER_FAILURE_REASON })
      continue
    }
    const result = await runAction(gate.action, gate.commandId, ctx)
    if (result.status !== 'ok') failed = true
    results.push(result)
  }
  return results
}
