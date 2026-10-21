import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ReservationDetail } from '../../../components/ReservationDetail'

export default function ReservationDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  if (!id) return null
  return (
    <Page>
      <PageBody>
        <ReservationDetail id={id} />
      </PageBody>
    </Page>
  )
}
