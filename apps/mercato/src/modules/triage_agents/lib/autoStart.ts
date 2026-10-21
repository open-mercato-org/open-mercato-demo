import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

export const TRIAGE_AUTO_START_ENV = 'OM_TRIAGE_AUTO_START'

type EnvLike = Record<string, string | undefined>

/**
 * Whether new tickets start the triage process on their own (the
 * `tickets.ticket.created` event trigger). `OM_TRIAGE_AUTO_START` wins when set;
 * otherwise it is on, except in integration runs (`OM_INTEGRATION_TEST`), where
 * background triage of every test-created ticket would race the optimistic-lock
 * assertions of other specs. Those runs start triage explicitly (manual trigger).
 */
export function resolveTriageAutoStart(env: EnvLike = process.env): boolean {
  const explicit = parseBooleanToken(env[TRIAGE_AUTO_START_ENV])
  if (explicit !== null) return explicit
  return parseBooleanToken(env.OM_INTEGRATION_TEST) !== true
}
