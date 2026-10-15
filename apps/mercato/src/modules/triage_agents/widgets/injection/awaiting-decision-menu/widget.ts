import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'
import { AWAITING_DECISION_FEATURES, AWAITING_DECISION_HREF } from '../../../data/constants'

export const AWAITING_DECISION_MENU_ITEM_ID = 'triage_agents-awaiting-decision-open'

const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'triage_agents.injection.awaiting-decision-menu',
    title: 'Awaiting decision menu item',
    description: 'Helpdesk sidebar entry opening the ticket queue filtered to proposals awaiting a decision.',
    features: [...AWAITING_DECISION_FEATURES],
    priority: 50,
    enabled: true,
  },
  menuItems: [
    {
      id: AWAITING_DECISION_MENU_ITEM_ID,
      label: 'Awaiting decision',
      labelKey: 'triage_agents.awaitingDecision.menu',
      icon: 'Inbox',
      href: AWAITING_DECISION_HREF,
      features: [...AWAITING_DECISION_FEATURES],
      groupId: 'tickets.nav.group',
      groupLabel: 'Helpdesk',
      groupLabelKey: 'tickets.nav.group',
      placement: { position: InjectionPosition.After, relativeTo: '/backend/tickets' },
    },
  ],
}

export default widget
