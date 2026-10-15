import { z } from 'zod'
import {
  classifierResultSchema,
  contextIdentifierResultSchema,
  resolutionAdvisorResultSchema,
} from '../data/validators'

const UNSUPPORTED_KEYWORDS = ['oneOf', 'allOf', 'not', 'if', 'then', 'else', 'dependentRequired', 'dependentSchemas', 'patternProperties']

function findUnsupported(node: unknown, path: string[] = []): string[] {
  if (Array.isArray(node)) return node.flatMap((item, index) => findUnsupported(item, [...path, String(index)]))
  if (!node || typeof node !== 'object') return []
  const record = node as Record<string, unknown>
  const own = UNSUPPORTED_KEYWORDS.filter((keyword) => keyword in record).map((keyword) => `${[...path, keyword].join('.')}`)
  return [...own, ...Object.entries(record).flatMap(([key, value]) => findUnsupported(value, [...path, key]))]
}

describe('triage agent result schemas as provider structured-output schemas', () => {
  it.each([
    ['context_identifier', contextIdentifierResultSchema],
    ['classifier', classifierResultSchema],
    ['resolution_advisor', resolutionAdvisorResultSchema],
  ])('%s uses only keywords accepted by OpenAI structured outputs', (_name, schema) => {
    const jsonSchema = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
    expect(findUnsupported(jsonSchema)).toEqual([])
  })
})
