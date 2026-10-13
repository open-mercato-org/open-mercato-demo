# Agent Orchestrator — Process Flow Trace, Replay & Embeddable Decision Card

> **Status:** Implemented (Phases A, B, C1–C3, E, F, G) · **Date:** 2026-10-12 · **Package:** `packages/enterprise/src/modules/agent_orchestrator`
> **Driven by:** [`../../2026-10-12-travel-ticket-triage-demo.md`](../../2026-10-12-travel-ticket-triage-demo.md) (demo Steps 5–6) · **Consumer:** [`../2026-10-12-triage-agents-module.md`](../2026-10-12-triage-agents-module.md)
> **Builds on:** `00-IMPLEMENTED-BASELINE.md`, `2026-09-06-business-process-workflow-unification.md` (ProcessInstance projection, subject facets), the per-run trace page, `POST /runs/:id/rerun`

## TLDR

**Key Points:**
- Six **generic, additive** AO capabilities (A–C UI and trace, E–G runtime) that the triage demo exposes but AO does not have yet. None of them is ticket-specific.
  - **A. Embeddable `ProposalDecisionCard`** — the Caseload decision UI as a reusable component, for any module's detail page. It edits long-text action fields properly (a reply draft) and shows a **citations panel** (the sources and steps a proposal is grounded in).
  - **B. Process Flow Trace** — one ordered, end-to-end view of an execution: trigger → workflow steps → agent runs (spans + tool calls) → disposition (who/what was edited) → effector command results. It is looked up by execution id. The consumer stores it, e.g. the `triage_agents` projection; an optional `subjectId` filter is additive.
  - **C. Replay** — (1) **Playback**: a client-side step-through of the *recorded* flow (no LLM calls, deterministic); (2) **Re-run execution**: start a new execution with the same trigger context, linked to the original, with a side-by-side outcome diff.

  - **E. Proposal execution** — a workflow function that executes the approved option's actions (today approval executes nothing: `executeProposal` has no production caller).
  - **F. Evidence envelope** — an additive `evidence` block on proposals, so checks, citations, draft segments and uncertainty survive envelope normalization.
  - **G. Scripted LLM provider** — a deterministic provider for integration tests and offline demo rehearsals.

**Out of scope:** external runtimes / graph nodes (LangGraph, DeepAgents): explicitly not added (umbrella D5); a graph DSL; replay that re-executes effectors.

## Problem Statement

1. Decisions can be made only in Caseload or on the workflow task detail page. A consultant working a ticket must leave it. Long string payload fields (a reply body) are edited as generic payload fields.
2. The trace page is **per run** (`/backend/agent_orchestrator/traces/[id]`, hidden from the nav). There is no single view that shows how a process moved from sources through decisions to approval, which is demo Step 6. `AgentTimeline` exists but is unmounted.
3. Replay = `POST /runs/:id/rerun` of one run, live. It cannot "replay the flow".

## Proposed Solution

### A. `ProposalDecisionCard` (embeddable)

- Exported from `@open-mercato/enterprise/modules/agent_orchestrator/components/ProposalDecisionCard`. It wraps the existing `ProposalCard`, `ProposalOptionList`, `ProposalFacts` and `DisposeDialog` logic and uses `apiCall`.
- Props: `{ proposalId: string, compact?: boolean, onDisposed?: (result) => void, fieldOverrides?: Record<string /* actionType.path */, { widget: 'long_text' | 'money' | 'readonly' | 'masked', labelKey?: string }> }`.
- **Long text:** an action payload field is rendered as a multi-line editor when (a) `fieldOverrides` says `long_text`, or (b) the agent's result schema marks it with `.describe('format:long_text')`. Edited values are re-assembled into the full envelope (`reassembleProposalPayload`, `AO/components/proposalEdit.ts`) and sent as `{ disposition: 'edited', selectedOptionId, payload, reason }` (the dispose API has no `edits` field; approve also requires `selectedOptionId`; edit/reject require `reason`). `deriveActionEdits` only handles flat primitives, so it is extended to string fields flagged `long_text`. The dispose call carries the optimistic lock header and surfaces conflicts via `surfaceRecordConflict`.
- **Citations panel (generic):** when the proposal payload carries `citations[]` (`{ kind, ref, label?, steps?, href? }`), per-check `step` refs, or `draftSegments[]`, the card renders a "Based on" panel. It lists the sources, the cited steps, checks ✓/✗ with evidence, and highlights `template` segments inside the long-text editor. Source text is resolved through a pluggable `citationResolvers` registry keyed by `kind`; a module registers e.g. `kb` → `knowledge_articles` version endpoint. Unknown kinds render as a plain label + link.
- Per-option approval stays atomic. Per-action toggles are out of scope: an option is the unit of approval.
- ACL: renders read-only without `agent_orchestrator.proposals.dispose`.
- Keyboard: `Cmd/Ctrl+Enter` approve (or save edits), `Escape` closes the edit mode.

- **As implemented (Phase A):**
  - **Import:** `@open-mercato/enterprise/modules/agent_orchestrator/components/ProposalDecisionCard`. Props: `{ proposalId, compact?, onDisposed?(result: { proposalId, disposition, selectedOptionId, updatedAt }), fieldOverrides?, canDispose?, approveLabel?, reloadToken?, className? }`. `canDispose` overrides the `POST /api/auth/feature-check` probe for `agent_orchestrator.proposals.dispose`. `approveLabel` lets a host say "Approve & send". `reloadToken` makes the host reload the card after its own events.
  - **Field overrides:** the keys are `<actionType>.<field>` or `*.<field>`. The value is `{ widget: 'long_text' | 'money' | 'readonly' | 'masked', labelKey?, revealable? }`. `revealable` is an additive extra for `masked`; the host decides who may reveal. Masked and read-only fields are never inputs, and their stored values pass through the edit unchanged. Schema-driven long text comes from the `outcomeSchema` that `GET /agents` serves: every action payload property whose `description` contains `format:long_text` counts (`collectLongTextFields`). A string value that already contains a newline also gets the long-text editor without an override (`isMultilineValue`), so an edit never flattens a multi-line draft.
  - **`deriveActionEdits`:** it needed no change. It already exposes flat string fields. The card picks the editor per field (a `Textarea` for long text) and re-assembles through `actionEditsToActions` + `reassembleProposalPayload`. The dispose body is built by `buildDisposeBody` (`components/decisionCardModel.ts`).
  - **Verdict flow:** approve goes straight to the endpoint (button or `Cmd/Ctrl+Enter`). Edit is inline; "Save & approve" opens `DisposeDialog` for the reason. Reject opens `DisposeDialog` with a reason that is required. `Escape` leaves edit mode. `DisposeDialog` gained an additive `confirmVariant` prop.
  - **Citations panel:** `components/ProposalCitationsPanel.tsx`. It reads `readProposalEvidence(payload)`. Template segments are highlighted wherever they still occur verbatim in the long-text value (`highlightTemplateSegments`); once an operator rewrites a sentence, its highlight disappears. Uncertainty entries render as chips.
  - **Resolver registry:** `components/citationResolvers.ts` exports `registerCitationResolver(kind, resolver) → unregister`, `getCitationResolver`, `listCitationResolverKinds` and `resolveCitation`. A resolver gets `{ kind, ref, label?, steps?, href? }` and returns `{ title, href?, steps?: [{ id, text }] } | null`, sync or async. The registry lives on `globalThis`, so duplicate bundles share it. Last registration wins. A missing resolver, a `null` result or a throwing resolver all fall back to `label ?? ref` + `href`.
  - **Call site:** the AO execution page (`/backend/processes/[id]`) embeds the card for the oldest pending proposal. The Caseload pages keep `ProposalCard` unchanged.

### B. Process Flow Trace

**API (additive):**
- `GET /api/agent_orchestrator/runs?workflowInstanceId=` — **new additive filter** (today `/runs` cannot filter by workflow instance; needed by the assembler and the UI).
- `GET /api/agent_orchestrator/executions?subjectId=` — optional additive filter (`subjectType` already exists).
- `GET /api/agent_orchestrator/executions/:id/flow` →
  ```ts
  type FlowNode = {
    id: string; seq: number; kind: 'trigger' | 'step' | 'agent_run' | 'tool_call' | 'function' | 'disposition' | 'effector'
    parentId: string | null; label: string; status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'waiting'
    startedAt: string | null; endedAt: string | null; durationMs: number | null
    refs: { workflowStepId?: string; runId?: string; spanId?: string; toolCallId?: string; proposalId?: string; commandId?: string }
    summary: Record<string, unknown>   // redacted: tool name + arg keys + result size; disposition: decision, actor, edited fields; effector: commandId + ok/error
  }
  type FlowResponse = { execution: { id, processKey, status, subject, startedAt, endedAt, rerunOfExecutionId }, nodes: FlowNode[] }
  ```
  It is built by a `lib/trace/flowAssembler.ts` that **joins existing records** (workflow instance + step history, `agent_runs`, `agent_spans`, `agent_tool_calls`, `agent_proposals` + disposition, the effector activity results). There is no new write path. Full tool payloads stay behind the existing per-run trace page (link out).
- **Component:** `ProcessFlowTrace` `{ executionId: string, attempts?: string[] /* execution ids */, showAttemptSelector?: boolean }`. A vertical timeline grouped by step. Agent runs expand to tool calls (CRM / ticket / KB calls are visible individually). Disposition shows who decided and a diff of the edited fields. Effector shows the command and its result. Each node deep-links to the run trace page. Live updates through the DOM event bridge (`agent_orchestrator.run.*`, `workflows.*` step events) while the execution is running.
- Also mount `ProcessFlowTrace` on the AO process execution detail page (`/backend/processes/[id]`). This closes the "AgentTimeline not mounted" gap.

- **As implemented (Phase B):**
  - **Code:** `lib/trace/flowAssembler.ts` is pure (fixtures pin the ordering and status rules). `lib/trace/flowLoader.ts` loads the records. The workflows entities are imported lazily as an optional peer: without them the flow still shows the trigger, the runs, the dispositions and the effector.
  - **Ordering:** `seq` comes from recorded time. Ties break by kind (trigger, step, agent_run, tool_call, disposition, function, effector).
  - **Parents:**
    - an agent run hangs under the step-instance row of its `stepId` that entered most recently before the run started;
    - a tool call hangs under its run;
    - a disposition hangs under its run;
    - the effector hangs under the disposition;
    - a function hangs under the transition's from-step.
  - **Function nodes:** read from `TRANSITION_EXECUTED` / `ACTIVITY_FAILED` events plus the definition's transition activities. The engine logs no per-activity event for a synchronous transition activity. When an effector span exists, the `execute_approved_proposal` function node is dropped so the same work is not shown twice.
  - **Status mapping:**
    - step: the `StepInstance.status` vocabulary;
    - run: `running`/`ok`/`error`/`cancelled`;
    - disposition: `pending` → `waiting`, `rejected` → `failed`, `none_proposed` → `skipped`, the rest → `succeeded`;
    - effector: the claim span's `attributes.ok` / `state`.
  - **Summaries:**
    - tool call: `{ toolName, argKeys, resultBytes }`, with secret-shaped keys masked;
    - agent run: `{ agentId, resultKind, confidence, model, outputFacts }`. The `outputFacts` are flattened output leaves (at most 60; strings clamped to 200 characters; secret keys masked). They feed the compare view. `trace.view` already grants the full run output via `GET /runs/:id`, so they expose nothing new;
    - disposition: `{ decision, actorKind, actor, reason, selectedOptionId, editedFields, proposal }`. `editedFields` is the per-field before/after diff of the selected option, taken from the `AgentCorrection` row. `proposal` holds the action types, citations and checks;
    - effector: `{ ok, state, results }`;
    - trigger: `{ triggerKind, inputKeys, sourceEntityType/Id, rerunOfExecutionId }`.
  - **Filters:** `GET /runs` gained `workflowInstanceId` and now also returns `step_id` and `rerun_of_run_id` (additive). `GET /executions` gained `subjectId`.
  - **Component:** `components/ProcessFlowTrace.tsx`. Props: `{ executionId, attempts?, showAttemptSelector?, allowRerun?, onRerunStarted?, onAttemptChange?, defaultMode?: 'live' | 'playback', className? }`. Live mode refetches, coalesced, on `agent_orchestrator.*` and `workflows.instance.*` app events while the execution is non-terminal. Run and tool-call nodes deep-link to `/backend/traces/:runId`. The component is mounted on `/backend/processes/[id]`. Its attempts there are `[rerunOf, current]`, read from `triggered_by`, and `allowRerun` is on.
  - **Not done:** the flow response is not cached (the spec suggested a `lastEventSeq`-keyed cache). Assembly is a handful of indexed, scoped queries, so the cache is a follow-up if long executions need it.

### C. Replay

1. **Playback (Phase C1):** a `ProcessFlowTrace` mode `playback`, with play / pause / step / speed controls. It reveals nodes in `seq` order using the recorded timestamps (compressed). Pure client-side over the `flow` response: zero LLM cost, deterministic, safe on stage.
2. **Re-run execution (Phase C2):** `POST /api/agent_orchestrator/executions/:id/rerun`. It starts a new execution of the same process definition (the current version) with the **original trigger context**, through the manual-trigger path (`processes.startExecution`). The link is stored in `rerun_of_execution_id`. Guards:
   - the process must declare a `manual` trigger
   - the caller needs `agent_orchestrator.processes.run`
   - it is rejected while the original has a pending proposal (`409 pending_proposal`) unless `supersede: true`; supersede rejects the pending proposal with the reason `superseded_by_rerun`
   - effectors run only after a new disposition, as normal
3. **Compare (Phase C3, stretch):** `ProcessFlowTrace` compares two attempts side by side: per-agent output diff, route, and proposed actions.

- **As implemented (Phase C):**
  - **C1 Playback:** the `playback` mode of `ProcessFlowTrace` (play / pause / step / restart, speed 0.5×–4×). It reveals nodes in `seq` order. Each delay is `clamp(sqrt(recorded gap ms) × 10, 250, 1500) / speed` (`playbackDelays`). It runs purely on the client over the `flow` response.
  - **C2 Re-run:** `POST /api/agent_orchestrator/executions/:id/rerun` `{ supersede? }` → `202 { executionId, rerunOfExecutionId, supersededProposalIds }`. `:id` is the execution id or the workflow instance id.
    - **Guards** (`lib/processes/rerunGuard.ts`): the execution needs a process definition (422). The definition must declare a `manual` trigger, and the caller must hold that trigger's `requireFeatures` (403). A pending proposal gives `409 { code: 'pending_proposal', pendingProposalIds }`. With `supersede`, the caller also needs `agent_orchestrator.proposals.dispose` (403).
    - **Supersede:** every pending proposal is rejected through the `agent_orchestrator.proposals.dispose` command with reason `superseded_by_rerun`. The command runs without the HTTP request, so no stale lock header applies.
    - **Start:** then `processes.startExecution` runs with the original `input`, `sourceEntityType/Id`, `idempotencyKey: null` and `triggeredBy { kind: 'manual', ref: <user>, rerunOfExecutionId }`. The mutation guard is wired.
  - **Migration decision:** there is no `rerun_of_execution_id` column. AO migrations are squash-only: one create-schema file, and the tests require exactly one. A new column would force a re-squash, which breaks databases already on the current squash. The link is stored as an optional `rerunOfExecutionId` on the `manual` arm of `processRunTriggeredBySchema` (`process_instances.triggered_by` jsonb, plaintext). It is read with `readRerunOfExecutionId`, and the flow header exposes it as `execution.rerunOfExecutionId`.
  - **C3 Compare:** the `compare` mode of `ProcessFlowTrace`, shown when there are two or more attempts. It is built by `compareFlows`. It shows the step route of each attempt; the proposal of each attempt (action types, citations with their `key@version`, so v3 vs v4 is visible, and checks ✓/✗); and, per agent, a diff of the output facts.

### E. Proposal execution

- **Problem:** `dispose` resumes the workflow via `resumeWorkflowForProposal` (`AO/lib/disposition/resume.ts`), which signals `{ proposalId, stepId, disposition, proposalPayload }`. Downstream steps can only template single values out of `context.proposalPayload`. They cannot pick the selected option or run several actions. `executeProposal` (`AO/lib/runtime/executeProposal.ts`) exists but is called only from tests, and it continues after a failed action.
- **Change:**
  1. The resume signal also carries `selectedOptionId`.
  2. `executeProposal` gains `stopOnFailure?: boolean` (default `false` keeps its current behaviour) and an RBAC gate equivalent to `UPDATE_ENTITY`'s (tenant enablement + the workflow user's features, `WF/lib/activity-executor.ts`).
  3. A new workflow function `agent_orchestrator.execute_approved_proposal`. It is registered in `AO/di.ts` as `workflowFunction:agent_orchestrator.execute_approved_proposal` and in the picker via `registerWorkflowFunctions`.
     - `args: { proposalId, stopOnFailure? = true, actionCommandMap? }`.
     - It loads the `AgentProposal` (scoped) and requires disposition `approved | edited`.
     - It reads the actions with `readProposalActions(payload, selectedOptionId)` (`AO/data/proposalEnvelope.ts`). It maps action type → command id (identity by default) and enforces `isEffectWithinVocabulary` ∩ the agent's `allowedActions` (fail closed).
     - It executes through the command bus with the workflow's scoped ctx and returns `{ ok, results: [{ type, commandId, status: 'ok'|'error'|'skipped', error? }] }`.
     - It is idempotent per proposal: a second call returns the recorded results.
- **Events:** `agent_orchestrator.proposal.executed` (with `clientBroadcast: true`) carrying the results.
- **As implemented (Phase E):**
  - Signal payload: `{ proposalId, stepId, disposition, selectedOptionId: string | null, proposalPayload }`.
  - `executeProposal(actions, ctx)` gains `stopOnFailure?: boolean` and `authorizeCommand?: (commandId) => Promise<{ allowed: true } | { allowed: false, reason }>`. Both are optional, so existing callers behave as before. With `stopOnFailure`, every action is gated first (mapping, vocabulary, authorization). One blocked action means nothing runs. After a command error, the remaining actions are `skipped`. The `UPDATE_ENTITY`-equivalent gate is `lib/runtime/workflowCommandAuthorizer.ts`: the command is workflow-safe, the tenant has enabled it, and the workflow user holds its `requiredFeatures`. It fails closed when there is no user, no catalogue or no `rbacService`.
  - The function is `lib/runtime/executeApprovedProposal.ts`. It is registered in `di.ts` (DI value plus a `registerWorkflowFunctions` descriptor with the label key `agent_orchestrator.workflowFunctions.executeApprovedProposal`). Its args are `{ proposalId: uuid, stopOnFailure?: boolean | 'true'/'false' (default true), actionCommandMap?: Record<type, commandId> }`. Types the map does not list fall back to the identity mapping.
  - Executable dispositions are `approved | edited | auto_approved`. The auto-approve path runs the same effector step. `pending`, `rejected`, `none_proposed`, `source = 'eval'`, a missing row or a missing `selected_option_id` all throw `[internal] …`. The proposal is loaded with `findOneWithDecryption` scoped to the workflow instance's tenant and organization. If the agent is no longer registered, its `allowedActions` is `[]`, so nothing runs.
  - Return value: `{ ok, proposalId, selectedOptionId, replayed, results: [{ type, commandId, status: 'ok'|'error'|'skipped', error? }] }`. A `skipped` result carries its reason in `error`, clamped to 500 characters. `ok` is true only when every action returned `ok`. Command failures are returned, not thrown, so the workflow can branch on `result.ok`.
  - **Idempotency storage (no schema change):** the execution is claimed by inserting a `system` `AgentSpan` on the proposing run, with `external_span_id = proposal-execution:<proposalId>` and name `agent_orchestrator.proposal.execute`. The existing unique `agent_spans_run_external_uq` makes the claim race-safe. The final `{ state, ok, results }` is recorded in the span's `attributes`, and the span status is `ok` or `error`. A repeat call replays the recorded results (`replayed: true`). A claim still `running` throws, so the activity retry policy can return after the first call finishes; the plan never runs twice. The span also gives Phase B a ready-made effector node. We did not add a column because the module's migrations are squash-only, and a new column would have forced a re-squash that breaks databases already on the current squash.
  - Event payload: `{ proposalId, selectedOptionId, ok, results, agentId, runId, workflowInstanceId, tenantId, organizationId }`. It is emitted once per real execution, never on a replay.

### F. Evidence envelope

- **Problem:** `normalizeProposalEnvelope` re-parses the agent output into `{ options, rationale }` and drops every other field.
- **Change:** an additive optional `evidence?: { checks?: { key, step?, passed, evidence }[], citations?: { kind, ref, label?, steps?, href? }[], segments?: { source: 'template'|'generated', ref?, text }[], uncertainty?: { code, message, blocking? }[] }` on the envelope schema (`AO/data/validators.ts`). It is preserved by `normalizeProposalEnvelope` and `reassembleProposalPayload`. Per-action `citations?: string[]` is also allowed on `proposedActionSchema`. Size cap: 32 KB, validated.
- This feeds the decision card's citations panel (§A) and the flow trace.
- **As implemented (Phase F):** the schemas are `proposalEvidenceSchema` and its parts in `data/validators.ts`, with the limits exported as constants. `PROPOSAL_EVIDENCE_MAX_BYTES = 32768` is the UTF-8 length of the serialized block. Citation refs are at most 300 characters, with at most 50 per action. `agentProposalSchema.evidence` is optional, so the agent result contract and `proposals.create` accept it and keep it. `normalizeProposalEnvelope` keeps a valid block and drops an invalid or oversized one (clamp, not reject). An action with a malformed `citations` list keeps the action and loses only the citations. `readProposalEvidence(payload)` reads the block from a stored payload, whether it is an object or decrypted JSON text. `replaceOptionActions`, and therefore `reassembleProposalPayload`, keep the evidence. `deriveActionEdits` / `actionEditsToActions` carry each action's `citations` through a structured edit.

### G. Scripted LLM provider

- An `LlmProvider` registered in `llmProviderRegistry` (`packages/shared/src/lib/ai/llm-provider-registry.ts`) under the id `scripted`. It is active only when `OM_AI_PROVIDER=scripted` and never in production builds (guarded by `NODE_ENV !== 'production'` or the explicit `OM_AI_SCRIPTED_ALLOW=1`).
- `createModel` returns an AI-SDK mock model that answers from fixture files `<module>/agents-fixtures/<agentId>/<inputKey>.json`. `inputKey` = AO's `canonicalInputKey(input)`. Fixtures can script tool calls first, so traces contain real tool-call spans.
- An unknown input → a deterministic error (`scripted_fixture_missing`), never a silent fallback to a real model.
- **As implemented (Phase G):**
  - **Location:** `@open-mercato/ai-assistant` → `lib/llm-adapters/scripted.ts`. It sits next to the other `LlmProvider` adapters and registers in `llm-bootstrap.ts`, the one place that fills `llmProviderRegistry`. `shared` holds only the port and must not depend on `ai`. AO is enterprise, and the provider is generic: chat agents can use it too.
  - **Registration:** the provider is registered only when `isScriptedLlmProviderEnabled(process.env)` is true at bootstrap, so it never appears in a real deployment's provider list. `isConfigured`, `resolveApiKey` and `createModel` re-check the guard each time.
  - **Model:** the model is a `MockLanguageModelV4` from `ai/test` (AI SDK 7), and `doStream` replays the same answer as stream parts.
  - **Fixture roots:** `OM_AI_SCRIPTED_FIXTURES_DIR` (separated by `path.delimiter`; relative paths resolve against the working directory) plus `registerScriptedLlmFixtureDirs([...])`. A module registers its `agents-fixtures/` directory this way.
  - **Fixture file:** `<root>/<agentId>/<inputKey>.json` = `{ steps?: [{ toolCalls: [{ toolName, input? }] }], object? | text?, usage?: { inputTokens?, outputTokens? } }`. Steps play one per assistant turn, only when the call offers tools, so one fixture serves both the tool loop and a single-shot `generateObject`. A dotted tool name maps to the SDK's `__` form. The tools really execute, so native trace capture records real tool spans.
  - **Fixture key:** `agentId` and `inputKey` come from an `AsyncLocalStorage` binding, `withScriptedLlmContext({ agentId, inputKey }, fn)` in `lib/llm-adapters/scripted-context.ts`. AO's `NativeAgentRunner` binds `canonicalInputKey(input)` around `runAiAgentObject`. A call made without a binding uses agent `_default` with the SHA-256 of the last user message.
  - **Errors:** `ScriptedLlmFixtureError` with `code` `scripted_fixture_missing` (also used for an unsafe path segment) or `scripted_fixture_invalid`.
  - **Limitation:** the model-factory precedence is unchanged (the ai-assistant guide says to ask first before changing it). `OM_AI_PROVIDER=scripted` is the lowest provider-axis tier. An agent `defaultProvider`, a slash-qualified `defaultModel`, `OM_AI_<MODULE>_PROVIDER` or a tenant runtime override still outranks it. Scripted runs therefore need agents that do not pin a provider, or `OM_AI_<MODULE>_PROVIDER=scripted`. With no real key configured, a pinned real provider fails closed rather than silently calling out.
  - Only the in-process (native) runtime is covered. OpenCode file agents call their model inside the OpenCode container.

## Architecture & Data Models

- ~~New column `process_instances.rerun_of_execution_id`~~ — superseded at build time: the link lives in `process_instances.triggered_by.rerunOfExecutionId` (squash-only migrations, see §C As implemented).
- No schema changes. Flow is assembled on read. The cache is tenant-scoped and keyed by `executionId + lastEventSeq`, invalidated by run/step events.

## API Contracts (summary)

| Method | Path | Feature | Notes |
|---|---|---|---|
| GET | `/api/agent_orchestrator/runs?workflowInstanceId` | `trace.view` | additive filter |
| GET | `/api/agent_orchestrator/executions?subjectId` | `processes.view` | optional additive filter (the list route's existing gate) |
| GET | `/api/agent_orchestrator/executions/:id/flow` | `trace.view` | redacted summaries only |
| POST | `/api/agent_orchestrator/executions/:id/rerun` | `processes.run` | `{ supersede?: boolean }` → `{ executionId, rerunOfExecutionId, supersededProposalIds }` |

All are added to `api/openapi.ts`.

## Backward Compatibility
Additive only: new routes, new optional query params, two new fields on the `/runs` list items, an optional `rerunOfExecutionId` on the `manual` `triggered_by` arm, an optional `confirmVariant` on `DisposeDialog`, new exported components. No existing contract changes. `ProposalCard`/Caseload keep their behaviour; `ProposalDecisionCard` composes them.

## Implementation Plan
- **Phase A** — `ProposalDecisionCard` + long-text field support + citations panel / `citationResolvers` + tests (dispose approve/edit/reject from an embedded host; optimistic-lock conflict).
- **Phase B** — `flowAssembler` + `/flow` + `runs?workflowInstanceId` filter + `ProcessFlowTrace` + mount on the execution page + live updates.
- **Phase E/F/G** (runtime, ships first) — the execute function + `stopOnFailure` + `selectedOptionId` in the signal; the evidence envelope; the scripted provider; unit tests (order, stop-on-failure, a disallowed action fails closed, idempotency, evidence preserved through normalize/reassemble). **Done** — tests: `AO/__tests__/{execute-approved-proposal,proposal-evidence,resume-selected-option}.test.ts`, `ai-assistant/.../lib/__tests__/llm-adapters-scripted.test.ts` (hit, scripted tool calls through `generateText` + `Output.object`, stream, missing fixture, production guard, bootstrap registration).
- **Phase C** — C1 playback; C2 re-run (no migration, see §C); C3 compare. **Done.**
- **Phase A/B/C tests** — unit: `AO/__tests__/{process-flow-assembler,decision-card-and-flow-models,execution-flow-rerun-routes}.test.ts`, `proposal-decision-card.test.tsx`; integration: `AO/__integration__/TC-AGENT-FLOW-001.spec.ts`.

### Testing
- Unit: `flowAssembler` ordering and status derivation (fixtures: success, manual route, rejected, effector failure); redaction (no raw tool payloads).
- Integration: `/runs?workflowInstanceId` returns only same-tenant runs; `/flow` 403 without `trace.view`; re-run links `rerun_of_execution_id` and refuses with a pending proposal; the decision card embedded in a test host disposes with edits.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Flow assembly is slow on long executions (many spans) | Medium | Tool calls collapsed to summaries; spans loaded lazily on expand; cache by `lastEventSeq` | Low |
| PII leaks through flow summaries | High | Summaries reuse the existing redacted `AgentToolCall` summaries; full payloads only via the per-run page with its existing ACL | Low |
| Re-run double-executes customer-facing actions | High | Re-run never replays effectors; a new disposition is required; supersede rejects the old proposal | Low |

## Final Compliance Report
Additive-only contracts ✅ · tenant scoping on the new filters ✅ · redaction preserved ✅ · `apiCall` / DS tokens / i18n in components ✅ · OpenAPI updated ✅ · no migration (link stored in `triggered_by`, squash-only module) ✅

## Changelog
- **2026-10-12** — Initial draft.
- **2026-10-12** — Dropped external nodes (LangGraph/DeepAgents) per umbrella D5; added the citations panel for KB grounding (D7).
- **2026-10-12** — Added §E proposal execution, §F evidence envelope and §G scripted provider (code research: approval executes nothing today; normalization drops extra fields; no stub LLM). Dispose contract corrected (full payload + `selectedOptionId`). Flow located by execution id; added the `runs?workflowInstanceId` filter.
- **2026-10-12** — Implemented Phase E/F/G. Spec corrections from the build: auto-approved proposals also execute (the auto path runs the same effector step); the result also carries `proposalId`, `selectedOptionId` and `replayed`; idempotency is stored in a claim `AgentSpan` rather than a new column (squash-only migrations); the scripted provider lives in `ai-assistant` and keys fixtures through an async-context binding set by AO; it does not override agent/module/tenant provider pins.
- **2026-10-13** — Implemented Phases A, B and C1–C3. Spec corrections from the build: the re-run link is `triggered_by.rerunOfExecutionId`, not a column (squash-only migrations); `GET /executions?subjectId` keeps the list's `processes.view` gate; the re-run response also carries `rerunOfExecutionId` and `supersededProposalIds`, refuses supersede without `proposals.dispose`, and returns 422 for an execution with no process definition; workflow functions are derived from transition events plus definition activities (the engine logs no per-activity event for synchronous transition activities); the flow response is not cached yet; the card is also embedded on the AO execution page; `fieldOverrides.masked` gained `revealable`; `DisposeDialog` gained `confirmVariant`.
