import {
  Effect,
  Exit,
  Fiber,
  type ManagedRuntime,
  Scope,
  Semaphore,
} from "effect";
import {
  type AuthorAvatarModel,
  AuthorAvatarSource,
  type GitHubRepository,
} from "#web/features/author-avatars/author-avatar.contract";
import { githubAvatarSource } from "#web/features/author-avatars/github-avatar-source";

export function createAuthorAvatarModel(
  repository: GitHubRepository,
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
  source = githubAvatarSource,
): AuthorAvatarModel {
  const scope = Scope.makeUnsafe();
  const permits = Semaphore.makeUnsafe(2);
  const cache = new Map<
    string,
    { readonly url: string | undefined; readonly expires: number }
  >();
  const pending = new Map<
    string,
    { readonly listeners: Set<() => void>; cancel: () => void }
  >();
  let pausedUntil = 0;
  let closed = false;
  return {
    get: (email) => cache.get(email.toLowerCase())?.url,
    subscribe: (author, listener) => {
      if (closed) return () => {};
      const key = author.author.email.toLowerCase();
      const cached = cache.get(key);
      if (cached !== undefined && cached.expires > Date.now()) return () => {};
      let request = pending.get(key);
      if (request === undefined) {
        const listeners = new Set([listener]);
        request = { listeners, cancel: () => {} };
        pending.set(key, request);
        const fiber = runtime.runSync(
          Effect.gen(function* () {
            if (Date.now() < pausedUntil) return undefined;
            const service = yield* AuthorAvatarSource;
            return yield* service.resolve(repository, author).pipe(
              Effect.catch((error) => {
                if (error.retryAt !== undefined)
                  pausedUntil = Math.max(pausedUntil, error.retryAt);
                return Effect.succeed(undefined);
              }),
            );
          }).pipe(
            Effect.provideService(AuthorAvatarSource, source),
            permits.withPermits(1),
            Effect.tap((url) =>
              Effect.sync(() => {
                if (closed) return;
                cache.delete(key);
                cache.set(key, {
                  url,
                  expires:
                    Date.now() + (url === undefined ? 60_000 : 86_400_000),
                });
                while (cache.size > 512) {
                  const oldest = cache.keys().next().value;
                  if (oldest !== undefined) cache.delete(oldest);
                }
                pending.delete(key);
                for (const notify of listeners) notify();
              }),
            ),
            Effect.forkIn(scope),
          ),
        );
        request.cancel = () => {
          runtime.runFork(Fiber.interrupt(fiber));
        };
      }
      request.listeners.add(listener);
      return () => {
        request.listeners.delete(listener);
        if (request.listeners.size === 0 && pending.get(key) === request) {
          pending.delete(key);
          request.cancel();
        }
      };
    },
    dispose: () => {
      closed = true;
      pending.clear();
      cache.clear();
      return runtime.runPromise(Scope.close(scope, Exit.void));
    },
  };
}
