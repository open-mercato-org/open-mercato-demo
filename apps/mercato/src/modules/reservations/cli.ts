import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { reanchorDemoReservationDates, seedReservationsDemo } from './lib/seeds'

function parseArgs(rest: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token?.startsWith('--')) continue
    const [rawKey, inlineValue] = token.slice(2).split('=', 2)
    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue
      continue
    }
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      args[rawKey] = next
      index += 1
    } else {
      args[rawKey] = 'true'
    }
  }
  return args
}

const reanchorDates: ModuleCli = {
  command: 'demo:reanchor-dates',
  async run(rest) {
    const args = parseArgs(rest)
    const container = await createRequestContainer()
    const result = await reanchorDemoReservationDates(container, {
      tenantId: args.tenant ?? args.tenantId ?? null,
      organizationId: args.org ?? args.organizationId ?? null,
    })
    console.log(`Re-anchored ${result.updated} demo reservation(s); ${result.unchanged} already up to date.`)
  },
}

const seedDemo: ModuleCli = {
  command: 'demo:seed',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = args.tenant ?? args.tenantId
    const organizationId = args.org ?? args.organizationId
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato reservations demo:seed --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const result = await seedReservationsDemo(container, { tenantId, organizationId })
    console.log(`Created ${result.peopleCreated} customer(s) and ${result.reservationsCreated} reservation(s).`)
  },
}

const commands: ModuleCli[] = [reanchorDates, seedDemo]

export default commands
