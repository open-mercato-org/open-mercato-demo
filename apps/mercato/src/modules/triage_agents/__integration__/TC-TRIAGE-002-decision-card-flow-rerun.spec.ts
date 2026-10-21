import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  DEMO_IBAN,
  OVERPAYMENT_ARTICLE_KEY,
  cleanupFixtures,
  createPersona,
  emptyFixtures,
  ensureKnowledgeBase,
  listOutboundArticles,
  listRefunds,
  publishKbArticleContent,
  readKbArticleByKey,
  readProposal,
  readTicket,
  sendEmail,
  settled,
  setupTriage,
  startTriage,
  waitForTriage,
  type Fixtures,
  type KbArticleContent,
} from './helpers'

const FINANCE_STEP = { id: 'S6', text: 'Refunds above 300 EUR require a finance review — do not promise a refund date.', checkKey: 'finance_review' }
const FINANCE_CHECK = { key: 'finance_review', label: 'Finance review for refunds above 300 EUR' }
const FINANCE_SENTENCE = 'our finance team reviews the refund first'

type Evidence = { checks?: Array<{ key: string }>; citations?: Array<{ ref: string }> }

async function readProposalDisposition(request: Parameters<typeof readProposal>[0], token: string, proposalId: string): Promise<string | null> {
  const response = await apiRequest(request, 'GET', `/api/agent_orchestrator/proposals?id=${proposalId}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id: string; disposition?: string }> }>(response)
  return body?.items?.find((item) => item.id === proposalId)?.disposition ?? null
}

/**
 * The ticket-side triage UI on top of the AO components: the embedded decision card
 * (KB citations resolved to the article version text), the Flow tab (agent runs, tool
 * calls, effector), and the demo's "edit the KB → re-run" moment with a pending
 * proposal (supersede) ending in an edited approval that requests the refund and sends
 * the reply. Scripted LLM provider; skips when the module or the provider is off.
 */
test.describe('TC-TRIAGE-002: triage decision card, flow tab and KB-driven re-run', () => {
  test('approves an edited v4 proposal after superseding the v3 one from the ticket page', async ({ page, request }) => {
    test.setTimeout(420_000)
    const token = await getAuthToken(request, 'admin')
    const setup = await setupTriage(request, token)
    test.skip(!setup, 'triage_agents is disabled (needs OM_ENABLE_ENTERPRISE_MODULES and OM_ENABLE_ENTERPRISE_MODULES_AGENTS)')
    test.skip(!setup?.scriptedProviderActive, 'the scripted LLM provider is not active (OM_AI_PROVIDER=scripted)')

    const fixtures: Fixtures = emptyFixtures()
    let originalArticle: KbArticleContent | null = null
    try {
      await ensureKnowledgeBase(request, token, fixtures)
      const anna = await createPersona(request, token, fixtures, 'anna2', [
        { departureInDays: 3, totalPrice: 2400, payments: [{ amount: 2000, status: 'booked' }, { amount: 750, status: 'booked' }] },
      ])
      const booking = anna.reservations[0].bookingNumber
      const ticketId = await sendEmail(request, token, fixtures, anna, {
        subject: `Refund of overpayment for booking ${booking}`,
        body: `Hello,\n\nI paid the second instalment for booking ${booking} twice by mistake. Please refund the overpayment on booking ${booking} to my account ${DEMO_IBAN}.\n\nThank you`,
      })
      if (!setup?.autoStart) await startTriage(request, token, ticketId)
      const first = await waitForTriage(request, token, ticketId, settled)
      expect(first.stage, JSON.stringify(first)).toBe('awaiting_approval')
      const firstProposalId = first.proposalId as string

      await login(page, 'admin')
      await page.goto(`/backend/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' })

      const decision = page.getByTestId('triage-decision-card')
      await expect(decision).toBeVisible({ timeout: 30_000 })
      const card = decision.getByTestId('ao-proposal-decision-card')
      await expect(card).toHaveAttribute('data-proposal-id', firstProposalId)
      await expect(card.getByRole('button', { name: 'Approve & send' })).toBeVisible()
      const citations = card.getByTestId('ao-decision-citations')
      await expect(citations.getByRole('link', { name: /Overpayment refund \(v\d+\)/ })).toHaveAttribute('href', /\/backend\/knowledge\/articles\//)
      await expect(citations.getByText(/Verify that the requester owns the booking/)).toBeVisible()
      await expect(citations.getByText(/Request the refund for the overpaid amount only/)).toBeVisible()
      await expect(page.getByTestId('triage-review-proposal')).toHaveAttribute('href', '#triage-decision-card')

      const flowTab = page.getByTestId('triage-flow-tab')
      await expect(flowTab).toBeVisible()
      const trace = flowTab.getByTestId('ao-process-flow-trace')
      await expect(trace).toHaveAttribute('data-execution-id', first.executionId as string, { timeout: 20_000 })
      await expect(trace.locator('[data-flow-kind="agent_run"]').first()).toBeVisible({ timeout: 20_000 })
      await expect(trace.locator('[data-flow-kind="tool_call"]').first()).toBeVisible()

      originalArticle = await readKbArticleByKey(request, token, OVERPAYMENT_ARTICLE_KEY)
      const publishedVersion = await publishKbArticleContent(request, token, OVERPAYMENT_ARTICLE_KEY, {
        procedureSteps: [...originalArticle.procedureSteps.filter((step) => step.id !== FINANCE_STEP.id), FINANCE_STEP],
        requiredChecks: [...originalArticle.requiredChecks.filter((check) => check.key !== FINANCE_CHECK.key), FINANCE_CHECK],
      })
      expect(publishedVersion).toBeGreaterThan(1)

      await flowTab.getByTestId('triage-flow-rerun').click()
      await page.getByRole('button', { name: 'Reject and re-run' }).click()

      const second = await waitForTriage(request, token, ticketId, (entry) => entry.attempt > first.attempt && settled(entry), 180_000)
      expect(second, JSON.stringify(second)).toMatchObject({ stage: 'awaiting_approval', groundingState: 'verified' })
      expect(second.proposalId).not.toBe(firstProposalId)
      expect(second.attempts?.[second.attempts.length - 1]).toMatchObject({
        executionId: first.executionId,
        disposition: 'rejected',
        reasonCode: 'superseded_by_rerun',
      })
      expect(await readProposalDisposition(request, token, firstProposalId)).toBe('rejected')
      expect((await readTicket(request, token, ticketId))?.manualReviewReasonCode).not.toBe('proposal_rejected')
      const secondProposal = await readProposal(request, token, second.proposalId as string)
      const evidence = secondProposal.payload.evidence as Evidence
      expect(evidence.checks?.map((check) => check.key)).toContain('finance_review')
      expect(evidence.citations?.[0]?.ref).toBe(`${OVERPAYMENT_ARTICLE_KEY}@${publishedVersion}`)

      await page.reload({ waitUntil: 'domcontentloaded' })
      const reloadedCard = page.getByTestId('triage-decision-card').getByTestId('ao-proposal-decision-card')
      await expect(reloadedCard).toHaveAttribute('data-proposal-id', second.proposalId as string, { timeout: 30_000 })
      await expect(reloadedCard.locator('[data-check-key="finance_review"]')).toBeVisible()
      await expect(reloadedCard.getByTestId('ao-decision-citations').getByText(/Refunds above 300 EUR require a finance review/)).toBeVisible()

      const reloadedTrace = page.getByTestId('triage-flow-tab').getByTestId('ao-process-flow-trace')
      await expect(reloadedTrace).toHaveAttribute('data-execution-id', second.executionId as string, { timeout: 20_000 })
      const attemptSelector = reloadedTrace.getByRole('combobox', { name: 'Attempt' })
      await expect(attemptSelector).toBeVisible()
      await attemptSelector.click()
      await expect(page.getByRole('option', { name: 'Attempt 1' })).toBeVisible()
      await expect(page.getByRole('option', { name: 'Attempt 2' })).toBeVisible()
      await page.keyboard.press('Escape')
      await reloadedTrace.getByText('Compare', { exact: true }).click()
      await expect(reloadedTrace.getByTestId('ao-flow-compare')).toBeVisible({ timeout: 20_000 })

      await reloadedCard.getByRole('button', { name: 'Edit' }).click()
      const body = reloadedCard.locator('[data-field-key="body"]').getByRole('textbox')
      const draft = await body.inputValue()
      expect(draft).toContain(FINANCE_SENTENCE)
      await body.fill(`${draft}\n\nWe apologise for the inconvenience.`)
      await reloadedCard.getByRole('button', { name: 'Save & approve' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox').fill('Added an apology to the reply')
      await dialog.getByRole('textbox').press('ControlOrMeta+Enter')

      const done = await waitForTriage(request, token, ticketId, (entry) => entry.attempt === second.attempt && (entry.stage === 'done' || entry.stage === 'failed'))
      expect(done, JSON.stringify(done)).toMatchObject({ stage: 'done', aiMode: 'assisted', disposition: 'edited', draftState: 'sent' })
      const refunds = await listRefunds(request, token, anna.reservations[0].id)
      expect(refunds).toHaveLength(1)
      expect(refunds[0]).toMatchObject({ status: 'requested', sourceType: 'agent_proposal' })
      expect(Number(refunds[0].amount)).toBe(350)
      const outbound = await listOutboundArticles(request, token, ticketId)
      expect(outbound).toHaveLength(1)
      expect(outbound[0].bodyText).toContain('We apologise for the inconvenience.')
      expect(outbound[0].bodyText).toContain(FINANCE_SENTENCE)

      await expect(page.getByTestId('triage-decision-card')).toHaveCount(0, { timeout: 20_000 })
      await page.reload({ waitUntil: 'domcontentloaded' })
      const finalTrace = page.getByTestId('triage-flow-tab').getByTestId('ao-process-flow-trace')
      await expect(finalTrace.locator('[data-flow-kind="disposition"]').first()).toBeVisible({ timeout: 20_000 })
      await expect(finalTrace.locator('[data-flow-kind="effector"]').first()).toBeVisible()
    } finally {
      if (originalArticle) {
        await publishKbArticleContent(request, token, OVERPAYMENT_ARTICLE_KEY, {
          procedureSteps: originalArticle.procedureSteps,
          requiredChecks: originalArticle.requiredChecks,
        }).catch(() => undefined)
      }
      await cleanupFixtures(request, token, fixtures)
    }
  })
})
