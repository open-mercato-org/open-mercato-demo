const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\}\}/g

export function extractTemplatePlaceholders(template: string | null | undefined): string[] {
  if (!template) return []
  const found = new Set<string>()
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    found.add(match[1])
  }
  return Array.from(found)
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function renderTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER_PATTERN, (whole: string, path: string) => {
    const value = readPath(variables, path)
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
    return whole
  })
}
