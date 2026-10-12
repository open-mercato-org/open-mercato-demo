export const metadata = {
  requireAuth: true,
  requireFeatures: ['tickets.view'],
  pageTitle: 'Ticket',
  pageTitleKey: 'tickets.detail.entityType',
  breadcrumb: [
    { label: 'Tickets', labelKey: 'tickets.queue.title', href: '/backend/tickets' },
    { label: 'Ticket', labelKey: 'tickets.detail.entityType' },
  ],
}
