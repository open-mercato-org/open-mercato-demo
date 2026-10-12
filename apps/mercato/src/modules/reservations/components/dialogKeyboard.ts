import type * as React from 'react'

export function submitDialogFormOnModEnter(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
  const form = event.currentTarget.querySelector('form')
  if (!form) return
  event.preventDefault()
  form.requestSubmit()
}
