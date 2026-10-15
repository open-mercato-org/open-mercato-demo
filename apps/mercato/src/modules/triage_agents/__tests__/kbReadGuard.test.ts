import { hasReadKbArticle, requireKbArticleRead } from '../lib/kbReadGuard'

type PrepareStepArgs = Parameters<typeof requireKbArticleRead>[0]

function state(toolNames: string[][]): PrepareStepArgs {
  return { steps: toolNames.map((names) => ({ toolCalls: names.map((toolName) => ({ toolName })) })) } as unknown as PrepareStepArgs
}

describe('KB read guard', () => {
  it('requires a tool call until the article is read', async () => {
    expect(await requireKbArticleRead(state([]))).toEqual({ toolChoice: 'required' })
    expect(await requireKbArticleRead(state([['tickets__get_ticket'], ['knowledge_articles__browse_taxonomy']]))).toEqual({ toolChoice: 'required' })
  })

  it('releases the tool choice once knowledge_articles.get_article ran', async () => {
    expect(await requireKbArticleRead(state([['tickets__get_ticket'], ['knowledge_articles__get_article']]))).toBeUndefined()
    expect(hasReadKbArticle({ steps: [{ toolCalls: [{ toolName: 'knowledge_articles.get_article' }] }] })).toBe(true)
  })
})
