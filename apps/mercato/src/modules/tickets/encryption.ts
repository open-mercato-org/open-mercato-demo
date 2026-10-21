import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'tickets:ticket',
    fields: [
      { field: 'subject' },
      { field: 'requester_email', hashField: 'requester_email_hash' },
      { field: 'requester_name' },
      { field: 'summary' },
    ],
  },
  {
    entityId: 'tickets:ticket_article',
    fields: [
      { field: 'from_email' },
      { field: 'to_email' },
      { field: 'subject' },
      { field: 'body_text' },
      { field: 'body_html' },
    ],
  },
  {
    entityId: 'tickets:ticket_reply_draft',
    fields: [
      { field: 'subject' },
      { field: 'body' },
    ],
  },
]

export default defaultEncryptionMaps
