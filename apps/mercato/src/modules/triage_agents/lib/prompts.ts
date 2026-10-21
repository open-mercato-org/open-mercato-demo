import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const PROMPT_SEGMENTS = ['src', 'modules', 'triage_agents', 'lib', 'prompts']

export type TriagePromptName = 'context_identifier' | 'classifier' | 'resolution_advisor'

const FALLBACK_PROMPTS: Record<TriagePromptName, string> = {
  context_identifier:
    'Identify the customer and reservation of the ticket with the tickets and reservations tools. Never guess, cite evidence, list uncertainty explicitly, write in English.',
  classifier:
    'Classify the ticket into one knowledge base topic using the knowledge base tools and summarise it in 1-3 English sentences without any IBAN. Never guess, cite evidence, list uncertainty explicitly.',
  resolution_advisor:
    'Follow the knowledge base article of the classified topic step by step, run its required checks against the reservation, and propose its recommended actions with citations, or propose nothing when a check fails. Never guess, cite evidence, list uncertainty explicitly, write in English.',
}

export function promptFileCandidates(name: TriagePromptName, cwd: string = process.cwd()): string[] {
  return [
    path.join(cwd, ...PROMPT_SEGMENTS, `${name}.md`),
    path.join(cwd, 'apps', 'mercato', ...PROMPT_SEGMENTS, `${name}.md`),
  ]
}

/**
 * Agent instructions live as sectioned markdown next to the code so they can be
 * reviewed like documentation. The short fallback keeps the agent loadable in a
 * bundle that did not ship the markdown files.
 */
export function loadTriagePrompt(name: TriagePromptName, cwd: string = process.cwd()): string {
  const file = promptFileCandidates(name, cwd).find((candidate) => existsSync(candidate))
  if (!file) return FALLBACK_PROMPTS[name]
  const text = readFileSync(file, 'utf8').trim()
  return text.length > 0 ? text : FALLBACK_PROMPTS[name]
}
