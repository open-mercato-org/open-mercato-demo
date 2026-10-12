export const metadata = {
  requireAuth: true,
  requireFeatures: ['reservations.manage'],
  pageTitle: 'New reservation',
  pageTitleKey: 'reservations.form.create.title',
  breadcrumb: [
    { label: 'Reservations', labelKey: 'reservations.nav.title', href: '/backend/reservations' },
    { label: 'New reservation', labelKey: 'reservations.form.create.title' },
  ],
}
