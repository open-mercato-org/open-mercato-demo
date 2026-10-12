/** @jest-environment node */
import { getWorkflowSafeCommand } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import aclFeatures from '../acl'
import { ticketsWorkflowSafeCommands } from '../workflows'
import en from '../i18n/en.json'

const declaredFeatureIds = new Set(aclFeatures.map((feature) => feature.id))
const translations = en as Record<string, string>

describe('tickets workflow-safe commands', () => {
  it('registers exactly the five spec commands', () => {
    expect(ticketsWorkflowSafeCommands.map((command) => command.commandId).sort()).toEqual([
      'tickets.reply.send',
      'tickets.reply_draft.save',
      'tickets.ticket.classify',
      'tickets.ticket.flag_manual_review',
      'tickets.ticket.transition',
    ])
    for (const command of ticketsWorkflowSafeCommands) {
      expect(getWorkflowSafeCommand(command.commandId)).not.toBeNull()
    }
  })

  it('requires declared features, labels every command and never grandfathers', () => {
    for (const command of ticketsWorkflowSafeCommands) {
      for (const feature of command.requiredFeatures) expect(declaredFeatureIds.has(feature)).toBe(true)
      expect(command.labelKey && translations[command.labelKey]).toBeTruthy()
      expect(command.defaultEnabled).toBeUndefined()
    }
  })
})
