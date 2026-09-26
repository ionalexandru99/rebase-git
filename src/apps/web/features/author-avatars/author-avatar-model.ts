import {
  type AuthorAvatarSource,
  type AvatarAuthor,
  AvatarUnavailable,
  type GitHubRepository,
} from "#web/features/author-avatars/author-avatar-source";
import { githubAvatarSource } from "#web/features/author-avatars/github-avatar-source";

export interface AuthorAvatarModel {
  readonly get: (email: string) => string | undefined;
  readonly subscribe: (
    author: AvatarAuthor,
    listener: () => void,
  ) => () => void;
  readonly dispose: () => void;
}

const concurrentLookups = 2;
const cachedAuthors = 512;
const avatarLifetimeMilliseconds = 86_400_000;
const missingAvatarLifetimeMilliseconds = 60_000;

interface CachedAvatar {
  readonly url: string | undefined;
  readonly expires: number;
}

interface PendingLookup {
  readonly listeners: Set<() => void>;
  readonly controller: AbortController;
}

export function createAuthorAvatarModel(
  repository: GitHubRepository,
  source: AuthorAvatarSource = githubAvatarSource,
): AuthorAvatarModel {
  const cache = new Map<string, CachedAvatar>();
  const pending = new Map<string, PendingLookup>();
  const permits = createPermits(concurrentLookups);
  let pausedUntil = 0;
  let closed = false;

  const resolveUnlessPaused = async (
    author: AvatarAuthor,
    signal: AbortSignal,
  ) => {
    if (Date.now() < pausedUntil) return undefined;
    try {
      return await source.resolve(repository, author, signal);
    } catch (error) {
      if (error instanceof AvatarUnavailable && error.retryAt !== undefined)
        pausedUntil = Math.max(pausedUntil, error.retryAt);
      throw error;
    }
  };

  const lookup = async (author: AvatarAuthor, signal: AbortSignal) => {
    try {
      return await permits(signal, () => resolveUnlessPaused(author, signal));
    } catch (error) {
      if (signal.aborted) throw error;
      return undefined;
    }
  };

  const remember = (key: string, url: string | undefined) => {
    cache.delete(key);
    cache.set(key, {
      url,
      expires:
        Date.now() +
        (url === undefined
          ? missingAvatarLifetimeMilliseconds
          : avatarLifetimeMilliseconds),
    });
    while (cache.size > cachedAuthors) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  };

  const start = (key: string, author: AvatarAuthor) => {
    const request: PendingLookup = {
      listeners: new Set(),
      controller: new AbortController(),
    };
    pending.set(key, request);
    lookup(author, request.controller.signal).then(
      (url) => {
        if (closed || pending.get(key) !== request) return;
        remember(key, url);
        pending.delete(key);
        for (const notify of request.listeners) notify();
      },
      () => undefined,
    );
    return request;
  };

  return {
    get: (email) => cache.get(email.toLowerCase())?.url,
    subscribe: (author, listener) => {
      if (closed) return () => {};
      const key = author.author.email.toLowerCase();
      const cached = cache.get(key);
      if (cached !== undefined && cached.expires > Date.now()) return () => {};
      const request = pending.get(key) ?? start(key, author);
      request.listeners.add(listener);
      return () => {
        request.listeners.delete(listener);
        if (request.listeners.size === 0 && pending.get(key) === request) {
          pending.delete(key);
          request.controller.abort();
        }
      };
    },
    dispose: () => {
      closed = true;
      for (const request of pending.values()) request.controller.abort();
      pending.clear();
      cache.clear();
    },
  };
}

function createPermits(count: number) {
  let available = count;
  const waiting: (() => void)[] = [];
  const release = () => {
    const next = waiting.shift();
    if (next === undefined) available += 1;
    else next();
  };
  const acquire = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (available > 0) {
        available -= 1;
        resolve();
        return;
      }
      const abort = () => {
        waiting.splice(waiting.indexOf(wake), 1);
        reject(signal.reason);
      };
      const wake = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      waiting.push(wake);
      signal.addEventListener("abort", abort, { once: true });
    });
  return async <Value>(signal: AbortSignal, use: () => Promise<Value>) => {
    signal.throwIfAborted();
    await acquire(signal);
    try {
      return await use();
    } finally {
      release();
    }
  };
}
