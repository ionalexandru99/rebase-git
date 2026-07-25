import { Effect, Layer } from 'effect'
import type { SimpleGit } from 'simple-git'
import { describe, expect, it } from 'vitest'
import { RepoSessions, type RepoSessionsService, requireGit } from '../sessions'

const fakeGit = { fake: true } as unknown as SimpleGit

const stubService = (overrides: Partial<RepoSessionsService>): RepoSessionsService => ({
  open: () => Effect.succeed(fakeGit),
  close: () => Effect.void,
  requireGit: () => Effect.succeed(fakeGit),
  requireOpen: () => Effect.void,
  isCommitGraphTracked: () => false,
  withSessionScope: (_repoPath, effect) => Effect.scoped(effect),
  ...overrides
})

describe('repo session helpers resolve through the provided RepoSessions layer', () => {
  it('requireGit returns the SimpleGit from the provided service, not the module singleton', async () => {
    let askedFor: string | null = null
    const service = stubService({
      requireGit: (repoPath) => {
        askedFor = repoPath
        return Effect.succeed(fakeGit)
      }
    })

    const result = await Effect.runPromise(
      requireGit('/any/repo').pipe(Effect.provide(Layer.succeed(RepoSessions, service)))
    )

    expect(result).toBe(fakeGit)
    expect(askedFor).toBe('/any/repo')
  })
})
