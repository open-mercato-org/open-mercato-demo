import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  {
    id: 'triage_agents.triage.updated',
    label: 'Ticket Triage Updated',
    entity: 'triage',
    category: 'lifecycle',
    clientBroadcast: true,
    excludeFromTriggers: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'triage_agents',
  events,
})

export const emitTriageAgentsEvent = eventsConfig.emit

export type TriageAgentsEventId = typeof events[number]['id']

export default eventsConfig
