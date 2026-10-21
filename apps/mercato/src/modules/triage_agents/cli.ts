import fs from 'node:fs'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getCliModules, type ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findAppRoot } from '@open-mercato/shared/lib/bootstrap/appResolver'
import { formatPasswordRequirements, getPasswordPolicy } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { DEMO_CONSULTANT_DEFAULT_EMAIL, SUPPORT_CONSULTANT_ROLE } from './data/constants'
import { ensureDemoConsultant, generateDemoPassword } from './lib/demoConsultant'
import { resetTriageDemo, resolveScenarios, sendScenario } from './lib/demo'
import { resolveTriageAutoStart } from './lib/autoStart'
import { seedTriageGoldenEvals } from './lib/goldenEvals'
import { ensureTriageProcess } from './lib/processSeed'
import { rebuildTriageProjection } from './lib/rebuild'
import { createProposalRejecter } from './lib/ticketDeletion'
import { resolveTicketPresenceReader } from './lib/ticketPresence'
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
    console.log(`Triage process ready: workflow ${result.workflowDefinitionId ?? '-'}, process ${result.processDefinitionId ?? '-'}${result.processCreated ? ' (created)' : ''}, auto-start ${result.autoStart ? 'on' : 'off'}.`)
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
    if (!resolveTriageAutoStart()) {
      console.log('Triage auto-start is off (OM_TRIAGE_AUTO_START / integration run): start triage with "Re-run triage" on each ticket, then re-run setup-process after enabling it.')
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
    const result = await rebuildTriageProjection(em, scope, {
      ticketId: flags.ticket ?? null,
      ticketPresence: resolveTicketPresenceReader(container),
      rejectProposal: createProposalRejecter(container, scope),
    })
    console.log(
      `Rebuilt ${result.rebuilt} triage projection entr(ies) from ${result.instances} workflow instance(s); cancelled ${result.cancelled} for deleted ticket(s).`,
    )
  },
}

const seedEvals: ModuleCli = {
  command: 'seed-evals',
  async run(rest) {
    const { flags } = parseArgs(rest)
    const scope = requireScope(flags, 'Usage: mercato triage_agents seed-evals --tenant <tenantId> --org <organizationId>')
    if (!scope) return
    const container = await createRequestContainer()
    const result = await seedTriageGoldenEvals(container, scope)
    if (!result.available) {
      console.log('The agent orchestrator is not available; no golden eval cases were seeded.')
      return
    }
    console.log(
      `Golden evals: ${result.assertionsCreated} assertion(s) created, ${result.casesCreated} case(s) created, ${result.casesExisting} already present.`,
    )
    if (result.missingScenarios.length > 0) {
      console.log(
        `No complete triage run yet for: ${result.missingScenarios.join(', ')}. Run "demo:send all", let the triage finish, then run seed-evals again.`,
      )
    }
  },
}

const DEMO_CONSULTANT_FILE = 'demo-consultant.json'

function writeConsultantCredentials(record: { email: string; password: string; createdAt: string }): string {
  const appRoot = findAppRoot()
  const directory = appRoot?.mercatoDir ?? path.join(process.cwd(), '.mercato')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, DEMO_CONSULTANT_FILE)
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.chmodSync(file, 0o600)
  return file
}

const demoConsultant: ModuleCli = {
  command: 'demo:consultant',
  async run(rest) {
    const { flags } = parseArgs(rest)
    const scope = requireScope(
      flags,
      'Usage: mercato triage_agents demo:consultant --tenant <tenantId> --org <organizationId> [--email <email>] [--password <password>]',
    )
    if (!scope) return
    const email = (flags.email ?? DEMO_CONSULTANT_DEFAULT_EMAIL).trim().toLowerCase()
    const providedPassword = flags.password && flags.password !== 'true' ? flags.password : null
    const password = providedPassword ?? generateDemoPassword()
    const modules = getCliModules()
    if (!modules.length) {
      console.error('No CLI modules registered. Run `yarn generate` first.')
      return
    }
    const container = await createRequestContainer()
    const result = await ensureDemoConsultant(container, { ...scope, email, password, modules })
    if (!result.ok) {
      if (result.reason === 'password_policy') {
        const requirements = formatPasswordRequirements(getPasswordPolicy(), (_key, fallback) => fallback)
        console.error(`The password does not meet the policy${requirements ? `: ${requirements}` : ''}.`)
      } else if (result.reason === 'organization_not_found') {
        console.error(`Organization ${scope.organizationId} was not found in tenant ${scope.tenantId}.`)
      } else {
        console.error(`${email} already exists with other roles (${result.detail ?? '-'}); pick another --email.`)
      }
      process.exitCode = 1
      return
    }
    console.log(`Support consultant ${result.created ? 'created' : 'updated'}: ${result.email} (role ${SUPPORT_CONSULTANT_ROLE}).`)
    if (providedPassword) return
    const file = writeConsultantCredentials({ email: result.email, password, createdAt: new Date().toISOString() })
    console.log(`Credentials written to ${file}`)
  },
}

const commands: ModuleCli[] = [setupProcess, demoSend, demoReset, rebuildProjection, seedEvals, demoConsultant]

export default commands
