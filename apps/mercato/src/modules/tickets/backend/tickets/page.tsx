"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import TicketsQueueTable from '../../components/TicketsQueueTable'

export default function TicketsQueuePage() {
  return (
    <Page>
      <PageBody>
        <TicketsQueueTable />
      </PageBody>
    </Page>
  )
}
