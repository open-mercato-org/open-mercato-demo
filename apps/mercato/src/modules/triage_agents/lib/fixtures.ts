import { existsSync } from 'node:fs'
import path from 'node:path'
import { registerScriptedLlmFixtureDirs } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/scripted'

const FIXTURE_SEGMENTS = ['src', 'modules', 'triage_agents', 'agents-fixtures']

export function triageFixtureDirCandidates(cwd: string = process.cwd()): string[] {
  return [
    path.join(cwd, ...FIXTURE_SEGMENTS),
    path.join(cwd, 'apps', 'mercato', ...FIXTURE_SEGMENTS),
  ]
}

/**
 * Registers the recorded agent answers used by the scripted LLM provider
 * (`OM_AI_PROVIDER=scripted` or `OM_AI_TRIAGE_AGENTS_PROVIDER=scripted`). The
 * directory only matters when that provider is active; registering it is inert
 * otherwise.
 */
export function registerTriageFixtureDirs(cwd: string = process.cwd()): string[] {
  const dirs = triageFixtureDirCandidates(cwd).filter((dir) => existsSync(dir))
  if (dirs.length > 0) registerScriptedLlmFixtureDirs(dirs)
  return dirs
}
