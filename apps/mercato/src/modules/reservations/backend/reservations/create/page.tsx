import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ReservationCreateForm } from '../../../components/ReservationForm'

export default function CreateReservationPage() {
  return (
    <Page>
      <PageBody>
        <ReservationCreateForm />
      </PageBody>
    </Page>
  )
}
