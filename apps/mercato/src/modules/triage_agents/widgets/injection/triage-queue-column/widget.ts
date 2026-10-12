import * as React from 'react'
import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'
import TriageQueueCell from './widget.client'

const widget: InjectionColumnWidget = {
  metadata: {
    id: 'triage_agents.injection.triage-queue-column',
    title: 'AI triage column',
    description: 'Shows the AI triage status and recommended action in the ticket queue.',
    features: ['triage_agents.view'],
    priority: 50,
    enabled: true,
  },
  columns: [
    {
      id: 'triage_agents.ai',
      headerKey: 'triage_agents.queue.column',
      header: 'AI',
      accessorKey: '_triage',
      size: 180,
      sortable: false,
      cell: ({ getValue }) => React.createElement(TriageQueueCell, { value: getValue() }),
    },
  ],
}

export default widget
