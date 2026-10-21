export const features = [
  { id: 'triage_agents.view', title: 'View AI ticket triage', module: 'triage_agents' },
  { id: 'triage_agents.run', title: 'Re-run AI ticket triage', module: 'triage_agents', dependsOn: ['triage_agents.view'] },
  { id: 'triage_agents.manage', title: 'Manage the AI triage demo', module: 'triage_agents', dependsOn: ['triage_agents.run'] },
]

export default features
