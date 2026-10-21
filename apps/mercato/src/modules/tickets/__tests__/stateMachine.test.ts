/** @jest-environment node */
import {
  assertTransition,
  canTransition,
  isTerminalStatus,
  nextStatuses,
  resolveTransitionPath,
  statusAfterInbound,
} from '../lib/stateMachine'
import { resolveReplyTargetStatus } from '../commands/replies'

describe('tickets state machine', () => {
  it('follows the spec lifecycle', () => {
    expect(nextStatuses('new')).toEqual(['open', 'resolved'])
    expect(canTransition('open', 'pending_customer')).toBe(true)
    expect(canTransition('open', 'pending_internal')).toBe(true)
    expect(canTransition('pending_customer', 'open')).toBe(true)
    expect(canTransition('pending_internal', 'open')).toBe(true)
    expect(canTransition('open', 'resolved')).toBe(true)
    expect(canTransition('resolved', 'closed')).toBe(true)
    expect(canTransition('resolved', 'open')).toBe(true)
  })

  it('rejects illegal moves', () => {
    expect(canTransition('new', 'closed')).toBe(false)
    expect(canTransition('pending_customer', 'resolved')).toBe(false)
    expect(canTransition('closed', 'open')).toBe(false)
    expect(() => assertTransition('closed', 'open')).toThrow()
    expect(() => assertTransition('new', 'open')).not.toThrow()
  })

  it('treats closed as terminal', () => {
    expect(isTerminalStatus('closed')).toBe(true)
    expect(isTerminalStatus('resolved')).toBe(false)
  })

  it('resolves one- and two-step paths', () => {
    expect(resolveTransitionPath('open', 'open')).toEqual([])
    expect(resolveTransitionPath('open', 'pending_customer')).toEqual(['pending_customer'])
    expect(resolveTransitionPath('new', 'pending_customer')).toEqual(['open', 'pending_customer'])
    expect(resolveTransitionPath('pending_internal', 'resolved')).toEqual(['open', 'resolved'])
    expect(resolveTransitionPath('closed', 'open')).toBeNull()
  })

  it('reopens on customer reply', () => {
    expect(statusAfterInbound('pending_customer')).toBe('open')
    expect(statusAfterInbound('resolved')).toBe('open')
    expect(statusAfterInbound('new')).toBe('new')
    expect(statusAfterInbound('pending_internal')).toBe('pending_internal')
  })

  it('picks the reply target status', () => {
    expect(resolveReplyTargetStatus('new', false)).toBe('pending_customer')
    expect(resolveReplyTargetStatus('open', true)).toBe('resolved')
    expect(resolveReplyTargetStatus('pending_internal', false)).toBe('pending_customer')
    expect(() => resolveReplyTargetStatus('closed', false)).toThrow()
  })
})
