export const metadata = {
  requireAuth: true,
  requireFeatures: ['reservations.manage'],
  pageTitle: 'Edit reservation',
  pageTitleKey: 'reservations.form.edit.pageTitle',
  breadcrumb: [
    { label: 'Reservations', labelKey: 'reservations.nav.title', href: '/backend/reservations' },
    { label: 'Edit reservation', labelKey: 'reservations.form.edit.pageTitle' },
  ],
}
