import {
  type AuthorAvatarSource,
  type AvatarAuthor,
  AvatarUnavailable,
} from "#web/features/author-avatars/author-avatar-providers.ts";
import type {
  AuthorAvatarStore,
  CachedAvatar,
} from "#web/features/author-avatars/author-avatar-store.ts";

export interface AuthorAvatarModel {
  readonly get: (email: string) => string | undefined;
  readonly subscribe: (
    author: AvatarAuthor,
    listener: () => void,
  ) => () => void;
  readonly dispose: () => void;
}

const concurrentLookups = 2;
const avatarLifetimeMilliseconds = 7 * 86_400_000;
const retryAfterFailureMilliseconds = 60_000;

interface PendingLookup {
  readonly listeners: Set<() => void>;
  readonly controller: AbortController;
}

export function createAuthorAvatarModel(
  source: AuthorAvatarSource,
  store: AuthorAvatarStore,
): AuthorAvatarModel {
  const cache = new Map<string, CachedAvatar>();
  const pending = new Map<string, PendingLookup>();
  const permits = createPermits(concurrentLookups);
  const loaded = store.load(source.provider).then(
    (stored) => {
      for (const [email, avatar] of stored)
        if (!cache.has(email)) cache.set(email, avatar);
    },
    () => undefined,
  );
  let pausedUntil = 0;
  let closed = false;

  const fresh = (key: string) => {
    const cached = cache.get(key);
    return cached !== undefined && cached.expires > Date.now()
      ? cached
      : undefined;
  };

  const resolveUnlessPaused = async (
    author: AvatarAuthor,
    signal: AbortSignal,
  ) => {
    if (Date.now() < pausedUntil) throw new AvatarUnavailable(pausedUntil);
    try {
      return await source.resolve(author, signal);
    } catch (error) {
      if (error instanceof AvatarUnavailable && error.retryAt !== undefined)
        pausedUntil = Math.max(pausedUntil, error.retryAt);
      throw error;
    }
  };

  const lookup = async (
    key: string,
    author: AvatarAuthor,
    signal: AbortSignal,
  ) => {
    await loaded;
    if (fresh(key) !== undefined) return;
    try {
      const url = await permits(signal, () =>
        resolveUnlessPaused(author, signal),
      );
      const avatar = { url, expires: Date.now() + avatarLifetimeMilliseconds };
      cache.set(key, avatar);
      store.save(source.provider, key, avatar);
    } catch (error) {
      if (signal.aborted) throw error;
      cache.set(key, {
        url: undefined,
        expires: Date.now() + retryAfterFailureMilliseconds,
      });
    }
  };

  const start = (key: string, author: AvatarAuthor) => {
    const request: PendingLookup = {
      listeners: new Set(),
      controller: new AbortController(),
    };
    pending.set(key, request);
    lookup(key, author, request.controller.signal).then(
      () => {
        if (closed || pending.get(key) !== request) return;
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
      if (fresh(key) !== undefined) return () => {};
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
