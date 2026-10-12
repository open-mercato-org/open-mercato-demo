import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Which recorded answer the scripted LLM provider should replay for the model calls
 * made inside {@link withScriptedLlmContext}.
 *
 * `inputKey` is the caller's own deterministic key for the run input — the Agent
 * Orchestrator passes its `canonicalInputKey(input)`, the same key its eval cases use —
 * so a fixture is addressed by `<agentId>/<inputKey>.json`. Binding it here keeps the
 * provider port (`LlmCreateModelOptions`) unchanged: a model instance never learns which
 * agent called it, and only this provider reads the binding.
 */
export type ScriptedLlmContext = {
  agentId: string
  inputKey: string
}

const scriptedContextStorage = new AsyncLocalStorage<ScriptedLlmContext>()

export function withScriptedLlmContext<T>(context: ScriptedLlmContext, fn: () => Promise<T>): Promise<T> {
  return scriptedContextStorage.run(context, fn)
}

export function getScriptedLlmContext(): ScriptedLlmContext | undefined {
  return scriptedContextStorage.getStore()
}
