"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'

export type ScenarioPreset = {
  key: string
  persona: string
  fromName: string
  fromEmail: string
  subject: string
  body: string
}

type ScenarioFormValues = { scenario: string }

type SimulateResponse = { ticketId: string; number: string; created: boolean }

export const ALL_SCENARIOS = 'all'

export function selectScenarios(presets: ScenarioPreset[], selected: string): ScenarioPreset[] {
  if (selected === ALL_SCENARIOS) return presets
  return presets.filter((preset) => preset.key === selected)
}

export function ScenarioPresetsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const router = useRouter()
  const [presets, setPresets] = React.useState<ScenarioPreset[] | null>(null)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    void apiCall<{ items: ScenarioPreset[] }>('/api/triage_agents/scenarios').then((call) => {
      if (!cancelled) setPresets(call.ok && Array.isArray(call.result?.items) ? call.result?.items ?? [] : [])
    })
    return () => {
      cancelled = true
    }
  }, [open])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'scenario',
      label: t('triage_agents.scenarios.field', 'Scenario'),
      type: 'select',
      required: true,
      options: [
        ...(presets ?? []).map((preset) => ({
          value: preset.key,
          label: t(`triage_agents.scenarios.items.${preset.key}`, `${preset.persona} — ${preset.subject}`),
        })),
        { value: ALL_SCENARIOS, label: t('triage_agents.scenarios.all', 'All six scenarios') },
      ],
    },
  ], [presets, t])

  const handleSubmit = React.useCallback(async (values: ScenarioFormValues) => {
    const chosen = selectScenarios(presets ?? [], values.scenario)
    const created: SimulateResponse[] = []
    for (const preset of chosen) {
      const call = await apiCallOrThrow<SimulateResponse>('/api/tickets/intake/simulate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromEmail: preset.fromEmail, fromName: preset.fromName, subject: preset.subject, body: preset.body }),
      })
      if (call.result) created.push(call.result)
    }
    flash(t('triage_agents.scenarios.sent', '{count} demo email(s) sent.', { count: created.length }), 'success')
    onClose()
    if (created.length === 1) router.push(`/backend/tickets/${encodeURIComponent(created[0].ticketId)}`)
  }, [onClose, presets, router, t])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      const form = event.currentTarget.querySelector('form')
      if (form) {
        event.preventDefault()
        form.requestSubmit()
      }
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="sm:max-w-xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('triage_agents.scenarios.title', 'Send demo scenario')}</DialogTitle>
          <DialogDescription>
            {t('triage_agents.scenarios.description', 'Sends one of the demo customer emails through the regular inbound intake; the AI triage starts on the new ticket.')}
          </DialogDescription>
        </DialogHeader>
        {presets === null ? (
          <LoadingMessage label={t('triage_agents.scenarios.loading', 'Loading scenarios…')} />
        ) : (
          <CrudForm<ScenarioFormValues>
            embedded
            fields={fields}
            initialValues={{ scenario: presets[0]?.key ?? ALL_SCENARIOS }}
            submitLabel={t('triage_agents.scenarios.submit', 'Send')}
            onSubmit={handleSubmit}
            extraActions={(
              <Button type="button" variant="outline" onClick={onClose}>
                {t('triage_agents.common.cancel', 'Cancel')}
              </Button>
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export default ScenarioPresetsDialog
