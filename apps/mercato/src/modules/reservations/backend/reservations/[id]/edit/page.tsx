import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ReservationEditForm } from '../../../../components/ReservationForm'

export default function EditReservationPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  if (!id) return null
  return (
    <Page>
      <PageBody>
        <ReservationEditForm id={id} />
      </PageBody>
    </Page>
  )
}
