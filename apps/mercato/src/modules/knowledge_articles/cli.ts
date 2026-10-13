import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { seedKnowledgeBase } from './lib/seeds'

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

const seedDemo: ModuleCli = {
  command: 'demo:seed',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = args.tenant ?? args.tenantId
    const organizationId = args.org ?? args.organizationId
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato knowledge_articles demo:seed --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const result = await seedKnowledgeBase(em, { tenantId, organizationId })
    console.log(`Seeded ${result.categories} categor(ies) and ${result.articles} article(s).`)
  },
}

const commands: ModuleCli[] = [seedDemo]

export default commands
