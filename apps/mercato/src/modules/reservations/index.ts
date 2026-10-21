import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'reservations',
  title: 'Reservations',
  version: '0.1.0',
  description: 'Travel reservations linked to customers, with payments, a computed balance and refund requests.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['customers'],
}
