export const MIN_CLASSIFICATION_CONFIDENCE = 0.6

export const ROUTE_REASON_CODES = [
  'context_not_found',
  'reservation_ambiguous',
  'identity_mismatch',
  'topic_manual_only',
  'kb_article_missing',
  'low_confidence',
] as const

export type RouteReasonCode = (typeof ROUTE_REASON_CODES)[number]

export type TriageRoute = 'assisted' | 'manual'

export type RouteCandidate = {
  reservationId?: string | null
  bookingNumber?: string | null
  label?: string | null
}

export type RouteUncertainty = {
  code?: string | null
  message?: string | null
  blocking?: boolean | null
}

export type RouteIdentification = {
  customer?: { personId?: string | null; match?: string | null } | null
  reservation?: {
    reservationId?: string | null
    bookingNumber?: string | null
    match?: string | null
    candidates?: RouteCandidate[] | null
  } | null
  uncertainty?: RouteUncertainty[] | null
}

export type RouteClassification = {
  topicKey?: string | null
  confidence?: number | null
  uncertainty?: RouteUncertainty[] | null
}

export type RouteArticlePolicy = {
  key: string
  version: number
  automationLevel: string
  manualReason: string | null
  targetQueueKey: string | null
  priorityFloor: string | null
}

export type RouteDecision = {
  route: TriageRoute
  reasonCode: RouteReasonCode | null
  reason: string | null
  targetQueueKey: string | null
}

function describeCandidates(candidates: RouteCandidate[] | null | undefined): string {
  const labels = (candidates ?? [])
    .map((candidate) => {
      const number = candidate.bookingNumber?.trim()
      const label = candidate.label?.trim()
      if (number && label) return `${number} (${label})`
      return number || label || null
    })
    .filter((value): value is string => Boolean(value))
  return labels.join(', ')
}

function manual(reasonCode: RouteReasonCode, reason: string, targetQueueKey: string | null): RouteDecision {
  return { route: 'manual', reasonCode, reason, targetQueueKey }
}

function hasBlockingUncertainty(...lists: Array<RouteUncertainty[] | null | undefined>): RouteUncertainty | null {
  for (const list of lists) {
    const blocking = (list ?? []).find((entry) => entry?.blocking === true)
    if (blocking) return blocking
  }
  return null
}

export function decideRoute(
  identification: RouteIdentification | null | undefined,
  classification: RouteClassification | null | undefined,
  article: RouteArticlePolicy | null,
): RouteDecision {
  const targetQueueKey = article?.targetQueueKey ?? null
  const customerMatch = identification?.customer?.match ?? 'not_found'
  const reservation = identification?.reservation ?? null
  const reservationMatch = reservation?.match ?? 'not_found'

  if (reservationMatch === 'identity_mismatch') {
    return manual(
      'identity_mismatch',
      'The booking number in the message belongs to a different customer than the sender.',
      targetQueueKey,
    )
  }
  if (reservationMatch === 'ambiguous') {
    const candidates = describeCandidates(reservation?.candidates)
    return manual(
      'reservation_ambiguous',
      candidates
        ? `Several reservations match and the message does not say which one: ${candidates}.`
        : 'Several reservations match and the message does not say which one.',
      targetQueueKey,
    )
  }
  if (customerMatch === 'not_found' || reservationMatch === 'not_found' || !reservation?.reservationId) {
    return manual('context_not_found', 'The customer or the reservation could not be identified.', targetQueueKey)
  }
  if (!article) {
    const topic = classification?.topicKey ? ` (${classification.topicKey})` : ''
    return manual('kb_article_missing', `No published knowledge base article was found for the topic${topic}.`, null)
  }
  if (article.automationLevel === 'manual_only') {
    return manual(
      'topic_manual_only',
      article.manualReason?.trim() || 'The knowledge base marks this topic as manual only.',
      targetQueueKey,
    )
  }
  const blocking = hasBlockingUncertainty(identification?.uncertainty, classification?.uncertainty)
  if (blocking) {
    return manual('low_confidence', blocking.message?.trim() || 'The analysis reported a blocking uncertainty.', targetQueueKey)
  }
  const confidence = typeof classification?.confidence === 'number' ? classification.confidence : 0
  if (confidence < MIN_CLASSIFICATION_CONFIDENCE) {
    return manual(
      'low_confidence',
      `The classification confidence (${Math.round(confidence * 100)}%) is below the ${Math.round(MIN_CLASSIFICATION_CONFIDENCE * 100)}% threshold.`,
      targetQueueKey,
    )
  }
  return { route: 'assisted', reasonCode: null, reason: null, targetQueueKey: null }
}
