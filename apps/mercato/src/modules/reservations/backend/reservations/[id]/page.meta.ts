export const metadata = {
  requireAuth: true,
  requireFeatures: ['reservations.view'],
  pageTitle: 'Reservation',
  pageTitleKey: 'reservations.detail.entityLabel',
  breadcrumb: [
    { label: 'Reservations', labelKey: 'reservations.nav.title', href: '/backend/reservations' },
    { label: 'Reservation', labelKey: 'reservations.detail.entityLabel' },
  ],
}
