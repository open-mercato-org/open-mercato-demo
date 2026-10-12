export const features = [
  { id: 'reservations.view', title: 'View reservations', module: 'reservations' },
  {
    id: 'reservations.manage',
    title: 'Manage reservations',
    module: 'reservations',
    dependsOn: ['reservations.view'],
  },
  {
    id: 'reservations.payment.record',
    title: 'Record reservation payments',
    module: 'reservations',
    dependsOn: ['reservations.view'],
  },
  {
    id: 'reservations.refund.request',
    title: 'Request reservation refunds',
    module: 'reservations',
    dependsOn: ['reservations.view'],
  },
  {
    id: 'reservations.refund.manage',
    title: 'Approve, execute or reject reservation refunds',
    module: 'reservations',
    dependsOn: ['reservations.view'],
  },
]

export default features
