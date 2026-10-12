"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DEFAULT_CURRENCY_CODE, RESERVATION_STATUSES } from '../data/constants'
import type { ReservationListItem } from './types'

const LIST_HREF = '/backend/reservations'
const API_PATH = 'reservations/reservations'
const ENTITY_ID = 'reservations:reservation'

type Translate = ReturnType<typeof useT>

export type ReservationFormValues = {
  id?: string
  bookingNumber: string
  customerPersonId: string
  status: string
  destination: string
  hotelName: string
  roomType: string
  boardType: string
  departureDate: string
  returnDate: string
  travelersCount: number | string
  totalPriceAmount: number | string
  currencyCode: string
  notes: string
  updatedAt?: string | null
}

type PeopleResponse = {
  items?: Array<{ id?: string; display_name?: string | null; primary_email?: string | null }>
}

async function loadPeopleOptions(query?: string): Promise<CrudFieldOption[]> {
  const params = new URLSearchParams({ page: '1', pageSize: '20' })
  if (query && query.trim()) params.set('search', query.trim())
  const data = await readApiResultOrThrow<PeopleResponse>(`/api/customers/people?${params.toString()}`)
  return (data.items ?? [])
    .filter((item): item is { id: string; display_name?: string | null; primary_email?: string | null } => typeof item.id === 'string')
    .map((item) => ({
      value: item.id,
      label: item.primary_email ? `${item.display_name ?? item.id} (${item.primary_email})` : item.display_name ?? item.id,
    }))
}

function useReservationFields(t: Translate, seedOptions: CrudFieldOption[]): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'bookingNumber',
      label: t('reservations.form.fields.bookingNumber', 'Booking number'),
      type: 'text',
      required: true,
      maxLength: 32,
      description: t('reservations.form.fields.bookingNumber.help', 'Stored uppercase without separators, e.g. ABC-123 becomes ABC123.'),
    },
    {
      id: 'customerPersonId',
      label: t('reservations.form.fields.customer', 'Customer'),
      type: 'combobox',
      required: true,
      loadOptions: loadPeopleOptions,
      seedOptions,
      allowCustomValues: false,
      placeholder: t('reservations.form.fields.customer.placeholder', 'Search people by name or email'),
    },
    {
      id: 'status',
      label: t('reservations.form.fields.status', 'Status'),
      type: 'select',
      options: RESERVATION_STATUSES.map((status) => ({ value: status, label: t(`reservations.status.${status}`, status) })),
    },
    { id: 'destination', label: t('reservations.form.fields.destination', 'Destination'), type: 'text', required: true },
    { id: 'hotelName', label: t('reservations.form.fields.hotelName', 'Hotel'), type: 'text', required: true },
    { id: 'roomType', label: t('reservations.form.fields.roomType', 'Room type'), type: 'text' },
    { id: 'boardType', label: t('reservations.form.fields.boardType', 'Board'), type: 'text' },
    { id: 'departureDate', label: t('reservations.form.fields.departureDate', 'Departure date'), type: 'date', required: true },
    { id: 'returnDate', label: t('reservations.form.fields.returnDate', 'Return date'), type: 'date', required: true },
    { id: 'travelersCount', label: t('reservations.form.fields.travelersCount', 'Travelers'), type: 'number' },
    { id: 'totalPriceAmount', label: t('reservations.form.fields.totalPrice', 'Total price'), type: 'number', required: true },
    { id: 'currencyCode', label: t('reservations.form.fields.currency', 'Currency'), type: 'text', maxLength: 3 },
    { id: 'notes', label: t('reservations.form.fields.notes', 'Internal notes'), type: 'textarea' },
  ], [seedOptions, t])
}

function useReservationGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'booking',
      title: t('reservations.form.groups.booking', 'Booking'),
      column: 1,
      fields: ['bookingNumber', 'customerPersonId', 'status', 'notes'],
    },
    {
      id: 'trip',
      title: t('reservations.form.groups.trip', 'Trip'),
      column: 2,
      fields: ['destination', 'hotelName', 'roomType', 'boardType', 'departureDate', 'returnDate', 'travelersCount'],
    },
    {
      id: 'price',
      title: t('reservations.form.groups.price', 'Price'),
      column: 2,
      fields: ['totalPriceAmount', 'currencyCode'],
    },
  ], [t])
}

export function toReservationPayload(values: ReservationFormValues): Record<string, unknown> {
  const optional = (value: string) => (value && value.trim() ? value.trim() : null)
  return {
    ...(values.id ? { id: values.id } : {}),
    bookingNumber: values.bookingNumber,
    customerPersonId: values.customerPersonId,
    status: values.status || undefined,
    destination: values.destination,
    hotelName: values.hotelName,
    roomType: optional(values.roomType ?? ''),
    boardType: optional(values.boardType ?? ''),
    departureDate: values.departureDate,
    returnDate: values.returnDate,
    travelersCount: values.travelersCount === '' ? undefined : Number(values.travelersCount),
    totalPriceAmount: Number(values.totalPriceAmount),
    currencyCode: (values.currencyCode || DEFAULT_CURRENCY_CODE).toUpperCase(),
    notes: optional(values.notes ?? ''),
  }
}

export function toReservationFormValues(item: ReservationListItem): ReservationFormValues {
  return {
    id: item.id,
    bookingNumber: item.bookingNumber,
    customerPersonId: item.customerPersonId,
    status: item.status,
    destination: item.destination,
    hotelName: item.hotelName,
    roomType: item.roomType ?? '',
    boardType: item.boardType ?? '',
    departureDate: item.departureDate ?? '',
    returnDate: item.returnDate ?? '',
    travelersCount: item.travelersCount,
    totalPriceAmount: item.totalPriceAmount,
    currencyCode: item.currencyCode,
    notes: item.notes ?? '',
    updatedAt: item.updatedAt ?? null,
  }
}

export function ReservationCreateForm() {
  const t = useT()
  const fields = useReservationFields(t, [])
  const groups = useReservationGroups(t)
  const initialValues = React.useMemo<Partial<ReservationFormValues>>(
    () => ({ status: 'pending_payment', currencyCode: DEFAULT_CURRENCY_CODE, travelersCount: 1 }),
    [],
  )
  return (
    <CrudForm<ReservationFormValues>
      title={t('reservations.form.create.title', 'New reservation')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      cancelHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('reservations.form.create.submit', 'Create reservation')}
      successRedirect={withFlash(LIST_HREF, t('reservations.flash.created', 'Reservation created'), 'success')}
      onSubmit={async (values) => {
        await createCrud(API_PATH, toReservationPayload(values))
      }}
    />
  )
}

export function ReservationEditForm({ id }: { id: string }) {
  const t = useT()
  const [initial, setInitial] = React.useState<ReservationFormValues | null>(null)
  const [seedOptions, setSeedOptions] = React.useState<CrudFieldOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const fields = useReservationFields(t, seedOptions)
  const groups = useReservationGroups(t)
  const detailHref = `/backend/reservations/${id}`

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await fetchCrudList<ReservationListItem>(API_PATH, { ids: id, pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) {
          setSeedOptions([{ value: item.customerPersonId, label: item.customerName ?? item.customerPersonId }])
          setInitial(toReservationFormValues(item))
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error && err.message ? err.message : t('reservations.errors.loadFailed', 'Failed to load reservation'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, t])

  if (loading) return <LoadingMessage label={t('reservations.detail.loading', 'Loading reservation…')} />
  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('reservations.errors.notFound', 'Reservation not found')}
        backHref={LIST_HREF}
        backLabel={t('reservations.detail.back', 'Back to reservations')}
      />
    )
  }
  if (error || !initial) return <ErrorMessage label={error ?? t('reservations.errors.loadFailed', 'Failed to load reservation')} />

  return (
    <CrudForm<ReservationFormValues>
      title={t('reservations.form.edit.title', 'Edit reservation {bookingNumber}', { bookingNumber: initial.bookingNumber })}
      titleHeadingLevel={1}
      backHref={detailHref}
      cancelHref={detailHref}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial}
      submitLabel={t('reservations.form.edit.submit', 'Save changes')}
      successRedirect={withFlash(detailHref, t('reservations.flash.saved', 'Reservation saved'), 'success')}
      onSubmit={async (values) => {
        await updateCrud(API_PATH, toReservationPayload({ ...values, id }))
      }}
      onDelete={async () => {
        await deleteCrud(API_PATH, id)
      }}
      deleteRedirect={withFlash(LIST_HREF, t('reservations.flash.deleted', 'Reservation deleted'), 'success')}
    />
  )
}
