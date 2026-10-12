# Agent Orchestrator — Process Flow Trace, Replay & Embeddable Decision Card

> **Status:** Draft · **Date:** 2026-10-12 · **Package:** `packages/enterprise/src/modules/agent_orchestrator`
> **Driven by:** [`../../2026-10-12-travel-ticket-triage-demo.md`](../../2026-10-12-travel-ticket-triage-demo.md) (demo Steps 5–6) · **Consumer:** [`../2026-10-12-triage-agents-module.md`](../2026-10-12-triage-agents-module.md)
> **Builds on:** `00-IMPLEMENTED-BASELINE.md`, `2026-09-06-business-process-workflow-unification.md` (ProcessInstance projection, subject facets), the per-run trace page, `POST /runs/:id/rerun`

## TLDR

**Key Points:**
- Three **generic, additive** AO capabilities that the triage demo exposes but AO does not have yet. None of them is ticket-specific.
  - **A. Embeddable `ProposalDecisionCard`** — the Caseload decision UI as a reusable component, for any module's detail page. It edits long-text action fields properly (a reply draft) and shows a **citations panel** (the sources and steps a proposal is grounded in).
  - **B. Process Flow Trace** — one ordered, end-to-end view of an execution: trigger → workflow steps → agent runs (spans + tool calls) → disposition (who/what was edited) → effector command results. It can be found by execution id **or by subject** (`subjectType` + `subjectId`).
  - **C. Replay** — (1) **Playback**: a client-side step-through of the *recorded* flow (no LLM calls, deterministic); (2) **Re-run execution**: start a new execution with the same trigger context, linked to the original, with a side-by-side outcome diff.

**Out of scope:** external runtimes / graph nodes (LangGraph, DeepAgents): explicitly not added (umbrella D5); a graph DSL; replay that re-executes effectors.

## Problem Statement

1. Decisions can be made only in Caseload or on the workflow task detail page. A consultant working a ticket must leave it. Long string payload fields (a reply body) are edited as generic payload fields.
2. The trace page is **per run** (`/backend/agent_orchestrator/traces/[id]`, hidden from the nav). There is no single view that shows how a process moved from sources through decisions to approval, which is demo Step 6. `AgentTimeline` exists but is unmounted.
3. Replay = `POST /runs/:id/rerun` of one run, live. It cannot "replay the flow".

## Proposed Solution

### A. `ProposalDecisionCard` (embeddable)

- Exported from `@open-mercato/enterprise/modules/agent_orchestrator/components/ProposalDecisionCard`. It wraps the existing `ProposalCard`, `ProposalOptionList`, `ProposalFacts` and `DisposeDialog` logic and uses `apiCall`.
- Props: `{ proposalId: string, compact?: boolean, onDisposed?: (result) => void, fieldOverrides?: Record<string /* actionType.path */, { widget: 'long_text' | 'money' | 'readonly' | 'masked', labelKey?: string }> }`.
- **Long text:** an action payload field is rendered as a multi-line editor when (a) `fieldOverrides` says `long_text`, or (b) the agent's result schema marks it with `.describe('format:long_text')`. Edited values are diffed (`deriveActionEdits`) and sent as `dispose{ decision: 'edit', edits }`. The dispose call carries the optimistic lock header and surfaces conflicts via `surfaceRecordConflict`.
- **Citations panel (generic):** when the proposal payload carries `citations[]` (`{ kind, ref, label?, steps?, href? }`), per-check `step` refs, or `draftSegments[]`, the card renders a "Based on" panel. It lists the sources, the cited steps, checks ✓/✗ with evidence, and highlights `template` segments inside the long-text editor. Source text is resolved through a pluggable `citationResolvers` registry keyed by `kind`; a module registers e.g. `kb` → `knowledge_articles` version endpoint. Unknown kinds render as a plain label + link.
- Per-option approval stays atomic. Per-action toggles are out of scope: an option is the unit of approval.
- ACL: renders read-only without `agent_orchestrator.proposals.dispose`.
- Keyboard: `Cmd/Ctrl+Enter` approve (or save edits), `Escape` closes the edit mode.

### B. Process Flow Trace

**API (additive):**
- `GET /api/agent_orchestrator/executions?subjectType=&subjectId=&limit=` — executions for a subject, newest first (uses the existing `process_instances` subject columns). Feature `agent_orchestrator.trace.view`.
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
- **Component:** `ProcessFlowTrace` `{ executionId? , subject?: { type, id }, showAttemptSelector?: boolean }`. A vertical timeline grouped by step. Agent runs expand to tool calls (CRM / ticket / KB calls are visible individually). Disposition shows who decided and a diff of the edited fields. Effector shows the command and its result. Each node deep-links to the run trace page. Live updates through the DOM event bridge (`agent_orchestrator.run.*`, `workflows.*` step events) while the execution is running.
- Also mount `ProcessFlowTrace` on the AO process execution detail page (`/backend/processes/[id]`). This closes the "AgentTimeline not mounted" gap.

### C. Replay

1. **Playback (Phase C1):** a `ProcessFlowTrace` mode `playback`, with play / pause / step / speed controls. It reveals nodes in `seq` order using the recorded timestamps (compressed). Pure client-side over the `flow` response: zero LLM cost, deterministic, safe on stage.
2. **Re-run execution (Phase C2):** `POST /api/agent_orchestrator/executions/:id/rerun`. It starts a new execution of the same process definition (the current version) with the **original trigger context**, through the manual-trigger path (`processes.startExecution`). The link is stored in `rerun_of_execution_id`. Guards:
   - the process must declare a `manual` trigger
   - the caller needs `agent_orchestrator.processes.run`
   - it is rejected while the original has a pending proposal (`409 pending_proposal`) unless `supersede: true`; supersede rejects the pending proposal with the reason `superseded_by_rerun`
   - effectors run only after a new disposition, as normal
3. **Compare (Phase C3, stretch):** `ProcessFlowTrace` compares two attempts side by side: per-agent output diff, route, and proposed actions.

## Architecture & Data Models

- **New column (additive):** `process_instances.rerun_of_execution_id uuid null` (+ index). Migration + snapshot.
- No other schema changes. Flow is assembled on read. The cache is tenant-scoped and keyed by `executionId + lastEventSeq`, invalidated by run/step events.

## API Contracts (summary)

| Method | Path | Feature | Notes |
|---|---|---|---|
| GET | `/api/agent_orchestrator/executions?subjectType&subjectId` | `trace.view` | additive filter on the existing list |
| GET | `/api/agent_orchestrator/executions/:id/flow` | `trace.view` | redacted summaries only |
| POST | `/api/agent_orchestrator/executions/:id/rerun` | `processes.run` | `{ supersede?: boolean }` → `{ executionId }` |

All are added to `api/openapi.ts`.

## Backward Compatibility
Additive only: new routes, a new optional query param, a nullable column, new exported components. No existing contract changes. `ProposalCard`/Caseload keep their behaviour; `ProposalDecisionCard` composes them.

## Implementation Plan
- **Phase A** — `ProposalDecisionCard` + long-text field support + citations panel / `citationResolvers` + tests (dispose approve/edit/reject from an embedded host; optimistic-lock conflict).
- **Phase B** — `flowAssembler` + `/flow` + subject filter + `ProcessFlowTrace` + mount on the execution page + live updates.
- **Phase C** — C1 playback; C2 re-run + migration; C3 compare (stretch).

### Testing
- Unit: `flowAssembler` ordering and status derivation (fixtures: success, manual route, rejected, effector failure); redaction (no raw tool payloads).
- Integration: the subject lookup returns only same-tenant executions; `/flow` 403 without `trace.view`; re-run links `rerun_of_execution_id` and refuses with a pending proposal; the decision card embedded in a test host disposes with edits.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Flow assembly is slow on long executions (many spans) | Medium | Tool calls collapsed to summaries; spans loaded lazily on expand; cache by `lastEventSeq` | Low |
| PII leaks through flow summaries | High | Summaries reuse the existing redacted `AgentToolCall` summaries; full payloads only via the per-run page with its existing ACL | Low |
| Re-run double-executes customer-facing actions | High | Re-run never replays effectors; a new disposition is required; supersede rejects the old proposal | Low |

## Final Compliance Report
Additive-only contracts ✅ · tenant scoping on the subject lookup ✅ · redaction preserved ✅ · `apiCall` / DS tokens / i18n in components ✅ · OpenAPI updated ✅ · migration with snapshot ✅

## Changelog
- **2026-10-12** — Initial draft.
- **2026-10-12** — Dropped external nodes (LangGraph/DeepAgents) per umbrella D5; added the citations panel for KB grounding (D7).
