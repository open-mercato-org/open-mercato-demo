/** @jest-environment jsdom */

const apiCallMock = jest.fn()
const pushMock = jest.fn()
let mockSearch = ''

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: jest.fn() }),
  usePathname: () => '/backend/tickets',
  useSearchParams: () => new URLSearchParams(mockSearch),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, string>) =>
    (fallback ?? key).replace('{count}', params?.count ?? '{count}'),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))
jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({ useAppEvent: () => undefined }))

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { clearNavBadge, useNavBadge } from '@open-mercato/ui/backend/nav/navBadges'
import { AWAITING_DECISION_HREF } from '../data/constants'
import AwaitingDecisionPresetWidget from '../widgets/injection/awaiting-decision-preset/widget.client'
import AwaitingDecisionNavBadgeWidget from '../widgets/injection/awaiting-decision-nav-badge/widget.client'

function mockCount(total: number | null) {
  apiCallMock.mockResolvedValue(total === null ? { ok: false, result: {} } : { ok: true, result: { total } })
}

function BadgeProbe() {
  const badge = useNavBadge(AWAITING_DECISION_HREF)
  return <span data-testid="probe">{badge ? `${badge.count}|${badge.label}` : 'none'}</span>
}

beforeEach(() => {
  apiCallMock.mockReset()
  pushMock.mockReset()
  mockSearch = ''
  clearNavBadge(AWAITING_DECISION_HREF)
})

describe('awaiting-decision preset', () => {
  it('shows the pending count and turns the filter on', async () => {
    mockCount(2)
    render(<AwaitingDecisionPresetWidget />)
    await waitFor(() => expect(screen.getByTestId('triage-awaiting-decision-count').textContent).toBe('2'))
    const button = screen.getByTestId('triage-awaiting-decision-preset')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    expect(pushMock).toHaveBeenCalledWith(AWAITING_DECISION_HREF, { scroll: false })
    expect(apiCallMock.mock.calls[0][0]).toBe('/api/triage_agents/awaiting-decision')
  })

  it('reads as pressed when the queue is filtered and turns the filter off', async () => {
    mockSearch = 'filter.triageDecision=awaiting'
    mockCount(0)
    render(<AwaitingDecisionPresetWidget />)
    const button = screen.getByTestId('triage-awaiting-decision-preset')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    expect(screen.queryByTestId('triage-awaiting-decision-count')).toBeNull()
    fireEvent.click(button)
    expect(pushMock).toHaveBeenCalledWith('/backend/tickets', { scroll: false })
  })
})

describe('awaiting-decision nav badge', () => {
  it('publishes the count onto the sidebar entry and clears it on a failed probe', async () => {
    mockCount(3)
    const { unmount } = render(<><AwaitingDecisionNavBadgeWidget /><BadgeProbe /></>)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('3|3 waiting for your decision'))
    unmount()
    mockCount(null)
    render(<><AwaitingDecisionNavBadgeWidget /><BadgeProbe /></>)
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('probe').textContent).toBe('none')
  })
})
