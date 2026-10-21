/** @jest-environment node */
import { htmlToPlainText, stripQuotedHistory, trimText } from '../lib/text'

describe('ticket text helpers', () => {
  it('strips quoted history after an "On … wrote:" header', () => {
    const body = 'Thanks, please refund.\n\nOn Mon, 12 Oct 2026, Support <s@example.com> wrote:\n> Earlier reply\n> more'
    expect(stripQuotedHistory(body)).toBe('Thanks, please refund.')
  })

  it('drops quoted ">" lines and original-message blocks', () => {
    expect(stripQuotedHistory('Hi\n> quoted\nThere')).toBe('Hi\nThere')
    expect(stripQuotedHistory('Reply\n-----Original Message-----\nFrom: x')).toBe('Reply')
  })

  it('keeps the original text when stripping would leave nothing', () => {
    expect(stripQuotedHistory('> only quoted')).toBe('> only quoted')
  })

  it('trims long text with a marker', () => {
    expect(trimText('abc', 10)).toEqual({ text: 'abc', truncated: false })
    const trimmed = trimText('a'.repeat(20), 10)
    expect(trimmed.truncated).toBe(true)
    expect(trimmed.text.length).toBe(10)
  })

  it('converts simple html to text', () => {
    expect(htmlToPlainText('<p>Hello&nbsp;<b>world</b></p><p>Bye &amp; thanks</p>')).toBe('Hello world\nBye & thanks')
  })
})
