import { syncProposalCreated, type ProposalCreatedPayload } from '../lib/proposalSync'
import { runTriageSync, type TriageSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'agent_orchestrator.proposal.created',
  persistent: true,
  id: 'triage_agents:proposal-created',
}

export default async function handle(payload: ProposalCreatedPayload, ctx: TriageSubscriberContext): Promise<void> {
  await runTriageSync('proposal_created', payload, ctx, (em, scope) => syncProposalCreated(em, scope, payload))
}
