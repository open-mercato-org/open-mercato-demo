import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resetTriageDemo, resolveScenarios, sendScenario } from './lib/demo'
import { ensureTriageProcess } from './lib/processSeed'
import { rebuildTriageProjection } from './lib/rebuild'
import { TRIAGE_SCENARIOS } from './lib/scenarios'

type ParsedArgs = { positional: string[]; flags: Record<string, string> }

function parseArgs(rest: string[]): ParsedArgs {
  const flags: Record<string, string> = {}
  const positional: string[] = []
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token) continue
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const [rawKey, inlineValue] = token.slice(2).split('=', 2)
    if (inlineValue !== undefined) {
      flags[rawKey] = inlineValue
      continue
    }
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      flags[rawKey] = next
      index += 1
    } else {
      flags[rawKey] = 'true'
    }
  }
  return { positional, flags }
}

function requireScope(flags: Record<string, string>, usage: string): { tenantId: string; organizationId: string } | null {
  const tenantId = flags.tenant ?? flags.tenantId
  const organizationId = flags.org ?? flags.organizationId
  if (!tenantId || !organizationId) {
    console.error(usage)
    return null
  }
  return { tenantId, organizationId }
}

const setupProcess: ModuleCli = {
  command: 'setup-process',
  async run(rest) {
    const { flags } = parseArgs(rest)
    const scope = requireScope(flags, 'Usage: mercato triage_agents setup-process --tenant <tenantId> --org <organizationId>')
    if (!scope) return
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const result = await ensureTriageProcess(container, em, scope)
    console.log(`Triage process ready: workflow ${result.workflowDefinitionId ?? '-'}, process ${result.processDefinitionId ?? '-'}${result.processCreated ? ' (created)' : ''}.`)
  },
}

const demoSend: ModuleCli = {
  command: 'demo:send',
  async run(rest) {
    const { positional, flags } = parseArgs(rest)
    const selector = positional[0] ?? flags.scenario ?? 'all'
    const usage = `Usage: mercato triage_agents demo:send <${TRIAGE_SCENARIOS.map((scenario) => scenario.key).join('|')}|all> --tenant <tenantId> --org <organizationId>`
    const scope = requireScope(flags, usage)
    if (!scope) return
    const scenarios = resolveScenarios(selector)
    if (scenarios.length === 0) {
      console.error(usage)
      return
    }
    const container = await createRequestContainer()
    for (const scenario of scenarios) {
      const ticket = await sendScenario(container, scope, scenario)
      console.log(`${scenario.key}: created ticket ${ticket.number} (${ticket.ticketId}) from ${scenario.persona}.`)
    }
  },
}

const demoReset: ModuleCli = {
  command: 'demo:reset',
  async run(rest) {
    const { flags } = parseArgs(rest)
    const scope = requireScope(flags, 'Usage: mercato triage_agents demo:reset --tenant <tenantId> --org <organizationId>')
    if (!scope) return
    const container = await createRequestContainer()
    const result = await resetTriageDemo(container, scope)
    console.log(
      `Closed ${result.ticketsClosed} demo ticket(s), cleared ${result.projectionsCleared} triage projection(s), re-anchored ${result.reservationsReanchored ?? 'no'} reservation(s).`,
    )
  },
}

const rebuildProjection: ModuleCli = {
  command: 'rebuild-projection',
  async run(rest) {
    const { flags } = parseArgs(rest)
    const scope = requireScope(flags, 'Usage: mercato triage_agents rebuild-projection --tenant <tenantId> --org <organizationId> [--ticket <ticketId>]')
    if (!scope) return
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const result = await rebuildTriageProjection(em, scope, { ticketId: flags.ticket ?? null })
    console.log(`Rebuilt ${result.rebuilt} triage projection entr(ies) from ${result.instances} workflow instance(s).`)
  },
}

const commands: ModuleCli[] = [setupProcess, demoSend, demoReset, rebuildProjection]

export default commands
