export const features = [
  { id: 'tickets.view', title: 'View tickets', module: 'tickets' },
  { id: 'tickets.manage', title: 'Manage tickets', module: 'tickets', dependsOn: ['tickets.view'] },
  { id: 'tickets.classify', title: 'Classify tickets', module: 'tickets', dependsOn: ['tickets.view'] },
  { id: 'tickets.reply', title: 'Reply to tickets', module: 'tickets', dependsOn: ['tickets.view'] },
  { id: 'tickets.intake.simulate', title: 'Simulate inbound ticket emails', module: 'tickets', dependsOn: ['tickets.view'] },
]

export default features
