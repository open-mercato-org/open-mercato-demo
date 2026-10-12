import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  DEMO_IBAN,
  cleanupFixtures,
  createPersona,
  disposeProposal,
  emptyFixtures,
  ensureKnowledgeBase,
  listOutboundArticles,
  listRefunds,
  readProposal,
  readTicket,
  sendEmail,
  settled,
  setupTriage,
  waitForTriage,
  type Fixtures,
} from './helpers'

type ProposalOption = { id: string; actions: Array<{ type: string; payload: Record<string, unknown> }> }

/**
 * Runs the whole triage process (tickets.ticket.created → identify → classify →
 * policy → classification applied → manual review or proposal → disposition →
 * effector) with the scripted LLM provider replaying `triage_agents/agents-fixtures`.
 * Skips when the module (enterprise agents flags) or the scripted provider is off.
 */
test.describe('TC-TRIAGE-001: AI ticket triage with the scripted provider', () => {
  test('triages the six demo scenarios, executes an edited approval and records a rejection', async ({ request }) => {
    test.setTimeout(420_000)
    const token = await getAuthToken(request, 'admin')
    const setup = await setupTriage(request, token)
    test.skip(!setup, 'triage_agents is disabled (needs OM_ENABLE_ENTERPRISE_MODULES and OM_ENABLE_ENTERPRISE_MODULES_AGENTS)')
    test.skip(!setup?.scriptedProviderActive, 'the scripted LLM provider is not active (OM_AI_PROVIDER=scripted)')
    expect(setup?.processDefinitionId).toBeTruthy()

    const fixtures: Fixtures = emptyFixtures()
    try {
      await ensureKnowledgeBase(request, token, fixtures)

      const anna = await createPersona(request, token, fixtures, 'anna', [
        { departureInDays: 3, totalPrice: 2400, payments: [{ amount: 2000, status: 'booked' }, { amount: 750, status: 'booked' }] },
      ])
      const rejected = await createPersona(request, token, fixtures, 'rejected', [
        { departureInDays: 3, totalPrice: 2400, payments: [{ amount: 2750, status: 'booked' }] },
      ])
      const peter = await createPersona(request, token, fixtures, 'peter', [
        { departureInDays: 40, totalPrice: 1800, payments: [{ amount: 1800, status: 'booked' }] },
      ])
      const maria = await createPersona(request, token, fixtures, 'maria', [
        { departureInDays: 12, totalPrice: 1350, payments: [{ amount: 1350, status: 'pending' }] },
      ])
      const emma = await createPersona(request, token, fixtures, 'emma', [
        { departureInDays: 9, totalPrice: 3100, hotelName: 'Hotel Aurora', destination: 'Rhodes, Greece' },
        { departureInDays: 120, totalPrice: 2600, hotelName: 'Hotel Sol', destination: 'Mallorca, Spain' },
      ])
      const tom = await createPersona(request, token, fixtures, 'tom', [{ departureInDays: 40, totalPrice: 1900 }])
      const john = await createPersona(request, token, fixtures, 'john', [
        { departureInDays: 21, totalPrice: 2200, destination: 'Sicily, Italy' },
        { departureInDays: 55, totalPrice: 1650, destination: 'Madeira, Portugal' },
      ])

      const refundEmail = (booking: string) => ({
        subject: `Refund of overpayment for booking ${booking}`,
        body: `Hello,\n\nI paid the second instalment for booking ${booking} twice by mistake. Please refund the overpayment on booking ${booking} to my account ${DEMO_IBAN}.\n\nThank you`,
      })
      const annaTicket = await sendEmail(request, token, fixtures, anna, refundEmail(anna.reservations[0].bookingNumber))
      const rejectedTicket = await sendEmail(request, token, fixtures, rejected, refundEmail(rejected.reservations[0].bookingNumber))
      const peterTicket = await sendEmail(request, token, fixtures, peter, {
        subject: 'Bank transfer confirmation',
        body: 'Hello,\n\nAttached is the confirmation of my bank transfer for our trip. Could you please confirm that you received the payment?',
      })
      const mariaTicket = await sendEmail(request, token, fixtures, maria, {
        subject: 'Payment confirmation for my trip',
        body: 'Hi,\n\nI am sending the payment confirmation for my trip. Please confirm that my booking is now fully paid.',
      })
      const emmaTicket = await sendEmail(request, token, fixtures, emma, {
        subject: 'Quiet room request',
        body: 'Hello,\n\nCould we get a room in a quiet part of Hotel Aurora? We are travelling with a small child.',
      })
      const tomTicket = await sendEmail(request, token, fixtures, tom, {
        subject: 'Complaint about our stay',
        body: 'Hello,\n\nOur room at the hotel was dirty when we arrived and the air-conditioning was broken for the whole week.',
      })
      const johnTicket = await sendEmail(request, token, fixtures, john, {
        subject: 'Change of travel date',
        body: 'Hello,\n\nCan I change the date of my trip?\n\nThanks',
      })

      const annaTriage = await waitForTriage(request, token, annaTicket, settled)
      expect(annaTriage.stage, JSON.stringify(annaTriage)).toBe('awaiting_approval')
      expect(annaTriage.identification?.reservation?.match).toBe('explicit_number_verified')
      expect(annaTriage.priority).toBe('high')
      expect(annaTriage.priorityReason).toBe('high – departure in 3 days')
      expect(annaTriage.recommendedActionLabel).toBe('Verify the overpayment and request a refund')
      expect(annaTriage.groundingState).toBe('verified')
      expect(annaTriage.draftState).toBe('prepared')
      const annaClassified = await readTicket(request, token, annaTicket)
      expect(annaClassified).toMatchObject({ topicKey: 'payments.refunds.overpayment_refund', priority: 'high', classificationSource: 'workflow' })

      const annaProposal = await readProposal(request, token, annaTriage.proposalId as string)
      const options = annaProposal.payload.options as ProposalOption[]
      const reply = options[0].actions.find((action) => action.type === 'tickets.reply.send')
      expect(reply).toBeTruthy()
      const editedBody = `${String(reply?.payload.body)}\n\nWe apologise for the inconvenience.`
      const editedPayload = {
        ...annaProposal.payload,
        options: [
          {
            ...options[0],
            actions: options[0].actions.map((action) =>
              action.type === 'tickets.reply.send' ? { ...action, payload: { ...action.payload, body: editedBody } } : action,
            ),
          },
        ],
      }
      await disposeProposal(request, token, annaTriage.proposalId as string, annaProposal.updatedAt, {
        disposition: 'edited',
        selectedOptionId: options[0].id,
        payload: editedPayload,
        reason: 'Added an apology to the reply',
      })
      const annaDone = await waitForTriage(request, token, annaTicket, (triage) => triage.stage === 'done' || triage.stage === 'failed')
      expect(annaDone, JSON.stringify(annaDone)).toMatchObject({ stage: 'done', aiMode: 'assisted', disposition: 'edited', draftState: 'sent' })
      const refunds = await listRefunds(request, token, anna.reservations[0].id)
      expect(refunds).toHaveLength(1)
      expect(refunds[0]).toMatchObject({ status: 'requested', sourceType: 'agent_proposal' })
      expect(Number(refunds[0].amount)).toBe(350)
      const outbound = await listOutboundArticles(request, token, annaTicket)
      expect(outbound).toHaveLength(1)
      expect(outbound[0].deliveryStatus).toBe('simulated')
      expect(outbound[0].bodyText).toContain('We apologise for the inconvenience.')

      const rejectedTriage = await waitForTriage(request, token, rejectedTicket, settled)
      expect(rejectedTriage.stage).toBe('awaiting_approval')
      const rejectedProposal = await readProposal(request, token, rejectedTriage.proposalId as string)
      await disposeProposal(request, token, rejectedTriage.proposalId as string, rejectedProposal.updatedAt, {
        disposition: 'rejected',
        reason: 'The customer already called; handled by phone',
      })
      const rejectedDone = await waitForTriage(request, token, rejectedTicket, (triage) => triage.stage === 'done' || triage.stage === 'failed')
      expect(rejectedDone).toMatchObject({ stage: 'done', aiMode: 'manual_review', reasonCode: 'proposal_rejected', draftState: 'rejected' })
      expect(await readTicket(request, token, rejectedTicket)).toMatchObject({ needsManualReview: true, manualReviewReasonCode: 'proposal_rejected' })
      expect(await listOutboundArticles(request, token, rejectedTicket)).toHaveLength(0)
      expect(await listRefunds(request, token, rejected.reservations[0].id)).toHaveLength(0)

      const peterTriage = await waitForTriage(request, token, peterTicket, settled)
      expect(peterTriage.stage, JSON.stringify(peterTriage)).toBe('awaiting_approval')
      expect(peterTriage.priorityReason).toBe('low – departure in 40 days')
      const peterProposal = await readProposal(request, token, peterTriage.proposalId as string)
      await disposeProposal(request, token, peterTriage.proposalId as string, peterProposal.updatedAt, {
        disposition: 'approved',
        selectedOptionId: (peterProposal.payload.options as ProposalOption[])[0].id,
      })
      const peterDone = await waitForTriage(request, token, peterTicket, (triage) => triage.stage === 'done' || triage.stage === 'failed')
      expect(peterDone).toMatchObject({ stage: 'done', aiMode: 'assisted' })
      expect((await readTicket(request, token, peterTicket))?.status).toBe('resolved')
      expect((await listOutboundArticles(request, token, peterTicket))[0]?.deliveryStatus).toBe('simulated')

      const manualCases: Array<{ ticketId: string; reasonCode: string; queueKey?: string; priority?: string }> = [
        { ticketId: mariaTicket, reasonCode: 'payment_not_visible' },
        { ticketId: emmaTicket, reasonCode: 'topic_manual_only' },
        { ticketId: tomTicket, reasonCode: 'topic_manual_only', queueKey: 'complaints', priority: 'normal' },
        { ticketId: johnTicket, reasonCode: 'reservation_ambiguous' },
      ]
      for (const manualCase of manualCases) {
        const triage = await waitForTriage(request, token, manualCase.ticketId, (entry) => entry.stage === 'done' || entry.stage === 'failed')
        expect(triage, JSON.stringify(triage)).toMatchObject({ stage: 'done', aiMode: 'manual_review', reasonCode: manualCase.reasonCode })
        const ticket = await readTicket(request, token, manualCase.ticketId)
        expect(ticket).toMatchObject({ needsManualReview: true, manualReviewReasonCode: manualCase.reasonCode })
        if (manualCase.queueKey) expect(ticket?.queueKey).toBe(manualCase.queueKey)
        if (manualCase.priority) expect(ticket?.priority).toBe(manualCase.priority)
      }
    } finally {
      await cleanupFixtures(request, token, fixtures)
    }
  })
})
