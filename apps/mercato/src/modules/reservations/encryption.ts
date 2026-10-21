import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'
import { RESERVATION_ENTITY_ID, RESERVATION_REFUND_ENTITY_ID } from './data/constants'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: RESERVATION_ENTITY_ID,
    fields: [
      { field: 'customer_email_snapshot', hashField: 'customer_email_hash' },
      { field: 'customer_name_snapshot' },
      { field: 'notes' },
    ],
  },
  {
    entityId: RESERVATION_REFUND_ENTITY_ID,
    fields: [
      { field: 'bank_account_number' },
      { field: 'reason' },
    ],
  },
]

export default defaultEncryptionMaps
