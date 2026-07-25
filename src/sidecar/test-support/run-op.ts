import { Effect } from 'effect'
import { type RepoSessions, RepoSessionsLive } from '../session/sessions'

export const runOp = <A, E>(effect: Effect.Effect<A, E, RepoSessions>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(RepoSessionsLive)))
