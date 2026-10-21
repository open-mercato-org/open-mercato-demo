import { asSchema } from 'ai'
import type { ZodTypeAny } from 'zod'
import {
  classifierResultSchema,
  contextIdentifierResultSchema,
  resolutionAdvisorResultSchema,
} from '../data/validators'

type JsonNode = Record<string, unknown>

const FORBIDDEN_KEYWORDS = [
  'oneOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  'dependentRequired',
  'dependentSchemas',
  'patternProperties',
  'unevaluatedProperties',
  'propertyNames',
  'minProperties',
  'maxProperties',
  'contains',
  'uniqueItems',
  'default',
]

const SUPPORTED_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid'])
const MAX_OBJECT_NESTING = 10
const MAX_TOTAL_PROPERTIES = 5000
const MAX_ENUM_VALUES = 1000

const SUBSCHEMA_KEYS = ['items', 'additionalItems'] as const

function isNode(value: unknown): value is JsonNode {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function typesOf(node: JsonNode): string[] {
  if (typeof node.type === 'string') return [node.type]
  if (Array.isArray(node.type)) return node.type.filter((entry): entry is string => typeof entry === 'string')
  return []
}

/**
 * OpenAI structured outputs (`strict: true`, the @ai-sdk/openai default) reject a
 * schema unless every object lists ALL of its properties in `required`, sets
 * `additionalProperties: false`, and uses only `anyOf` for alternatives. Optional
 * fields must be expressed as nullable instead. This walks the JSON Schema the AI
 * SDK actually sends to the provider and reports every violation with its path.
 */
function findStrictModeViolations(root: unknown): string[] {
  const violations: string[] = []
  let totalProperties = 0
  if (!isNode(root) || !typesOf(root).includes('object') || 'anyOf' in root) {
    violations.push('<root>: the root schema must be a plain object (not anyOf)')
  }
  const visit = (node: unknown, path: string[], objectDepth: number): void => {
    if (!isNode(node)) return
    const where = path.length ? path.join('.') : '<root>'
    for (const keyword of FORBIDDEN_KEYWORDS) {
      if (keyword in node) violations.push(`${where}: unsupported keyword "${keyword}"`)
    }
    if (typeof node.format === 'string' && !SUPPORTED_FORMATS.has(node.format)) {
      violations.push(`${where}: unsupported format "${node.format}"`)
    }
    if (Array.isArray(node.enum) && node.enum.length > MAX_ENUM_VALUES) {
      violations.push(`${where}: enum has more than ${MAX_ENUM_VALUES} values`)
    }
    const isObject = typesOf(node).includes('object') || isNode(node.properties)
    let depth = objectDepth
    if (isObject) {
      depth += 1
      if (depth > MAX_OBJECT_NESTING) violations.push(`${where}: object nesting deeper than ${MAX_OBJECT_NESTING}`)
      const properties = isNode(node.properties) ? node.properties : {}
      const keys = Object.keys(properties)
      totalProperties += keys.length
      if (keys.length === 0) violations.push(`${where}: an object must declare its properties (no free-form records)`)
      if (node.additionalProperties !== false) violations.push(`${where}: additionalProperties must be false`)
      const required = Array.isArray(node.required) ? node.required : null
      if (!required) {
        violations.push(`${where}: "required" must be an array listing every property`)
      } else {
        const missing = keys.filter((key) => !required.includes(key))
        if (missing.length > 0) violations.push(`${where}: "required" misses ${missing.join(', ')}`)
      }
      for (const [key, child] of Object.entries(properties)) visit(child, [...path, 'properties', key], depth)
    }
    for (const key of SUBSCHEMA_KEYS) {
      const child = node[key]
      if (Array.isArray(child)) child.forEach((entry, index) => visit(entry, [...path, key, String(index)], depth))
      else visit(child, [...path, key], depth)
    }
    if (Array.isArray(node.anyOf)) node.anyOf.forEach((entry, index) => visit(entry, [...path, 'anyOf', String(index)], depth))
    for (const defsKey of ['$defs', 'definitions']) {
      const defs = node[defsKey]
      if (isNode(defs)) for (const [key, child] of Object.entries(defs)) visit(child, [...path, defsKey, key], depth)
    }
  }
  visit(root, [], 0)
  if (totalProperties > MAX_TOTAL_PROPERTIES) violations.push(`<root>: more than ${MAX_TOTAL_PROPERTIES} properties in total`)
  return violations
}

async function providerJsonSchema(schema: ZodTypeAny): Promise<unknown> {
  return await asSchema(schema as never).jsonSchema
}

describe('triage agent result schemas as OpenAI strict structured-output schemas', () => {
  it.each([
    ['context_identifier', contextIdentifierResultSchema],
    ['classifier', classifierResultSchema],
    ['resolution_advisor', resolutionAdvisorResultSchema],
  ])('%s produces a provider JSON schema that satisfies OpenAI strict mode', async (_name, schema) => {
    expect(findStrictModeViolations(await providerJsonSchema(schema))).toEqual([])
  })

  it('the checker flags the shapes OpenAI rejects', () => {
    const violations = findStrictModeViolations({
      type: 'object',
      properties: {
        segments: {
          type: 'array',
          items: { type: 'object', properties: { ref: { type: 'string' }, text: { type: 'string' } }, required: ['text'] },
        },
        choice: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      },
      required: ['segments', 'choice'],
      additionalProperties: false,
    })
    expect(violations).toEqual(
      expect.arrayContaining([
        'properties.segments.items: additionalProperties must be false',
        'properties.segments.items: "required" misses ref',
        'properties.choice: unsupported keyword "oneOf"',
      ]),
    )
  })
})
