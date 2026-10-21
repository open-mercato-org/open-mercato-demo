import { syncProposalExecuted, type ProposalExecutedPayload } from '../lib/proposalSync'
import { runTriageSync, type TriageSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'agent_orchestrator.proposal.executed',
  persistent: true,
  id: 'triage_agents:proposal-executed',
}

export default async function handle(payload: ProposalExecutedPayload, ctx: TriageSubscriberContext): Promise<void> {
  await runTriageSync('proposal_executed', payload, ctx, (em, scope) => syncProposalExecuted(em, scope, payload))
}
