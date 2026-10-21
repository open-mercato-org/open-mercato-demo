import type {
  KnowledgeProcedureStep,
  KnowledgeRecommendedAction,
  KnowledgeRequiredCheck,
} from '../data/validators'

export type ArticleStructureInput = {
  procedureSteps: KnowledgeProcedureStep[]
  requiredChecks: KnowledgeRequiredCheck[]
  recommendedActions: KnowledgeRecommendedAction[]
}

export type ArticleStructureIssue = {
  field: 'procedureSteps' | 'requiredChecks' | 'recommendedActions'
  index: number
  messageKey: string
}

function findDuplicates(values: string[]): Set<number> {
  const seen = new Set<string>()
  const duplicates = new Set<number>()
  values.forEach((value, index) => {
    if (seen.has(value)) duplicates.add(index)
    else seen.add(value)
  })
  return duplicates
}

export function validateArticleStructure(input: ArticleStructureInput): ArticleStructureIssue[] {
  const issues: ArticleStructureIssue[] = []
  findDuplicates(input.procedureSteps.map((step) => step.id)).forEach((index) => {
    issues.push({ field: 'procedureSteps', index, messageKey: 'knowledge_articles.errors.duplicateStepId' })
  })
  findDuplicates(input.requiredChecks.map((check) => check.key)).forEach((index) => {
    issues.push({ field: 'requiredChecks', index, messageKey: 'knowledge_articles.errors.duplicateCheckKey' })
  })
  findDuplicates(input.recommendedActions.map((action) => action.actionKey)).forEach((index) => {
    issues.push({ field: 'recommendedActions', index, messageKey: 'knowledge_articles.errors.duplicateActionKey' })
  })
  const checkKeys = new Set(input.requiredChecks.map((check) => check.key))
  const actionKeys = new Set(input.recommendedActions.map((action) => action.actionKey))
  input.procedureSteps.forEach((step, index) => {
    if (step.checkKey && !checkKeys.has(step.checkKey)) {
      issues.push({ field: 'procedureSteps', index, messageKey: 'knowledge_articles.errors.unknownStepCheck' })
    }
    if (step.actionKey && !actionKeys.has(step.actionKey)) {
      issues.push({ field: 'procedureSteps', index, messageKey: 'knowledge_articles.errors.unknownStepAction' })
    }
  })
  return issues
}

export function nextStepId(steps: Array<Pick<KnowledgeProcedureStep, 'id'>>): string {
  let max = 0
  for (const step of steps) {
    const match = /^S([1-9][0-9]*)$/.exec(step.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `S${max + 1}`
}

export function renumberSteps<T extends Pick<KnowledgeProcedureStep, 'id'>>(steps: T[]): T[] {
  return steps.map((step, index) => ({ ...step, id: `S${index + 1}` }))
}
