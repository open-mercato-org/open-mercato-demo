export type ReservationListItem = {
  id: string
  bookingNumber: string
  customerPersonId: string
  customerName: string | null
  customerEmail: string | null
  status: string
  destination: string
  hotelName: string
  roomType: string | null
  boardType: string | null
  departureDate: string | null
  returnDate: string | null
  travelersCount: number
  totalPriceAmount: string
  currencyCode: string
  notes: string | null
  daysToDeparture: number | null
  balance?: { paidTotal?: number; refundedTotal?: number; outstanding?: number; overpayment?: number } | null
  updatedAt: string | null
}

export type PaymentListItem = {
  id: string
  reservationId: string
  amount: string
  currencyCode: string
  status: string
  method: string
  paidAt: string | null
  bookedAt: string | null
  externalReference: string | null
  updatedAt: string | null
}

export type RefundListItem = {
  id: string
  reservationId: string
  amount: string
  currencyCode: string
  bankAccountLast4: string
  reason: string | null
  status: string
  sourceType: string | null
  sourceRef: string | null
  relatedTicketId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type ReservationBalanceDto = {
  totalPrice: number
  paidTotal: number
  pendingPaymentsTotal: number
  refundedTotal: number
  outstanding: number
  overpayment: number
  currencyCode: string
  daysToDeparture: number | null
}

export type ListResponse<T> = {
  items: T[]
  total: number
  page?: number
  pageSize?: number
  totalPages?: number
  totalIsCapped?: boolean
}
