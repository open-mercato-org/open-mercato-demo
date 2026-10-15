import type { AiAgentLoopConfig } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'

const KB_ARTICLE_TOOL_NAMES = new Set(['knowledge_articles.get_article', 'knowledge_articles__get_article'])

type LoopStepState = { steps?: ReadonlyArray<{ toolCalls?: ReadonlyArray<{ toolName?: string }> }> }

export function hasReadKbArticle(state: LoopStepState): boolean {
  return (state.steps ?? []).some((step) => (step.toolCalls ?? []).some((call) => KB_ARTICLE_TOOL_NAMES.has(call.toolName ?? '')))
}

/**
 * Model-agnostic guard: until the agent has called `knowledge_articles.get_article`
 * it may not answer — every step must be a tool call. Once the article is read the
 * default tool choice returns and the agent can produce its structured result.
 */
export const requireKbArticleRead: NonNullable<AiAgentLoopConfig['prepareStep']> = async (state) =>
  hasReadKbArticle(state as LoopStepState) ? undefined : { toolChoice: 'required' }
