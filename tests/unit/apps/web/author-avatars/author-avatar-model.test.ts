import { describe, expect, it, vi } from "vite-plus/test";
import { createAuthorAvatarModel } from "#web/features/author-avatars/author-avatar-model";
import { AvatarUnavailable } from "#web/features/author-avatars/author-avatar-source";

const author = {
  oid: "a".repeat(40),
  author: {
    name: "Alexandru Ion",
    email: "alex@example.test",
    timestampSeconds: 0,
    timezoneOffsetMinutes: 0,
  },
};
const repository = { owner: "alex", name: "rebase" };
const avatar = "https://avatars.githubusercontent.com/u/123?s=40";

function neverResolves(aborted: () => void) {
  return (_repository: unknown, _author: unknown, signal: AbortSignal) =>
    new Promise<string | undefined>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted();
        reject(signal.reason);
      });
    });
}

describe("author avatar loading", () => {
  it("deduplicates a visible author across commits and reuses the completed lookup", async () => {
    const { promise, resolve: finish } = Promise.withResolvers<
      string | undefined
    >();
    const resolve = vi.fn(() => promise);
    const model = createAuthorAvatarModel(repository, { resolve });
    try {
      const first = vi.fn();
      const second = vi.fn();
      const unsubscribe = model.subscribe(author, first);
      const unsubscribeSecond = model.subscribe(
        { ...author, oid: "b".repeat(40) },
        second,
      );
      await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
      expect(model.get(author.author.email)).toBeUndefined();
      finish(avatar);
      await vi.waitFor(() => expect(first).toHaveBeenCalledOnce());
      expect(second).toHaveBeenCalledOnce();
      unsubscribe();
      unsubscribeSecond();
      model.subscribe(author, vi.fn())();
      expect(model.get(author.author.email)).toBe(avatar);
      expect(resolve).toHaveBeenCalledOnce();
    } finally {
      model.dispose();
    }
  });

  it("cancels work when its last visible row leaves and resumes on return", async () => {
    const aborted = vi.fn();
    const resolve = vi.fn(neverResolves(aborted));
    const model = createAuthorAvatarModel(repository, { resolve });
    try {
      const leave = model.subscribe(author, vi.fn());
      await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
      leave();
      expect(aborted).toHaveBeenCalledOnce();
      model.subscribe(author, vi.fn());
      await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    } finally {
      model.dispose();
    }
    expect(aborted).toHaveBeenCalledTimes(2);
  });

  it("pauses further authors after GitHub rate limits the client", async () => {
    const resolve = vi.fn(() =>
      Promise.reject(new AvatarUnavailable(Date.now() + 60_000)),
    );
    const model = createAuthorAvatarModel(repository, { resolve });
    try {
      const done = vi.fn();
      model.subscribe(author, done);
      await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
      const next = vi.fn();
      model.subscribe(
        {
          ...author,
          author: { ...author.author, email: "other@example.test" },
        },
        next,
      );
      await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
      expect(resolve).toHaveBeenCalledOnce();
    } finally {
      model.dispose();
    }
  });

  it("runs at most two lookups at once and starts a queued author when one finishes", async () => {
    const lookups = new Map<string, PromiseWithResolvers<string | undefined>>();
    const resolve = vi.fn((_repository: unknown, lookup: { oid: string }) => {
      const pending = Promise.withResolvers<string | undefined>();
      lookups.set(lookup.oid, pending);
      return pending.promise;
    });
    const model = createAuthorAvatarModel(repository, { resolve });
    try {
      for (const name of ["first", "second", "third"])
        model.subscribe(
          {
            oid: name,
            author: { email: `${name}@example.test` },
          },
          vi.fn(),
        );
      await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
      lookups.get("first")?.resolve(undefined);
      await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(3));
    } finally {
      model.dispose();
    }
  });

  it("skips queued authors once GitHub rate limits a running lookup", async () => {
    const lookups: PromiseWithResolvers<string | undefined>[] = [];
    const resolve = vi.fn(() => {
      const pending = Promise.withResolvers<string | undefined>();
      lookups.push(pending);
      return pending.promise;
    });
    const model = createAuthorAvatarModel(repository, { resolve });
    try {
      const queued = vi.fn();
      for (const name of ["first", "second", "third"])
        model.subscribe(
          { oid: name, author: { email: `${name}@example.test` } },
          name === "third" ? queued : vi.fn(),
        );
      await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
      for (const lookup of lookups)
        lookup.reject(new AvatarUnavailable(Date.now() + 60_000));
      await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce());
      expect(resolve).toHaveBeenCalledTimes(2);
    } finally {
      model.dispose();
    }
  });
});
