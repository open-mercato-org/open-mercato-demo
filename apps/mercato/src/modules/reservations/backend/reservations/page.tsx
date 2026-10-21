import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ReservationsTable from '../../components/ReservationsTable'

export default function ReservationsListPage() {
  return (
    <Page>
      <PageBody>
        <ReservationsTable />
      </PageBody>
    </Page>
  )
}
