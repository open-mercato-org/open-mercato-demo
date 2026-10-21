import { syncProposalDisposed, type ProposalDisposedPayload } from '../lib/proposalSync'
import { runTriageSync, type TriageSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'agent_orchestrator.proposal.disposed',
  persistent: true,
  id: 'triage_agents:proposal-disposed',
}

export default async function handle(payload: ProposalDisposedPayload, ctx: TriageSubscriberContext): Promise<void> {
  await runTriageSync('proposal_disposed', payload, ctx, (em, scope) => syncProposalDisposed(em, scope, payload))
}
