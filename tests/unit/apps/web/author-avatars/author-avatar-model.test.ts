import { Deferred, Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { AvatarUnavailable } from "#web/features/author-avatars/author-avatar.contract";
import { createAuthorAvatarModel } from "#web/features/author-avatars/author-avatar-model";

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

describe("author avatar loading", () => {
  it("deduplicates a visible author across commits and reuses the completed lookup", async () => {
    const result = Deferred.makeUnsafe<string | undefined>();
    const resolve = vi.fn(() => Deferred.await(result));
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
      await Effect.runPromise(Deferred.succeed(result, avatar));
      await vi.waitFor(() => expect(first).toHaveBeenCalledOnce());
      expect(second).toHaveBeenCalledOnce();
      unsubscribe();
      unsubscribeSecond();
      model.subscribe(author, vi.fn())();
      expect(model.get(author.author.email)).toBe(avatar);
      expect(resolve).toHaveBeenCalledOnce();
    } finally {
      await model.dispose();
    }
  });

  it("cancels work when its last visible row leaves and resumes on return", async () => {
    const interrupted = vi.fn();
    const resolve = vi.fn(() =>
      Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(interrupted))),
    );
    const model = createAuthorAvatarModel(repository, { resolve });
    try {
      const leave = model.subscribe(author, vi.fn());
      await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
      leave();
      await vi.waitFor(() => expect(interrupted).toHaveBeenCalledOnce());
      model.subscribe(author, vi.fn());
      await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    } finally {
      await model.dispose();
    }
    expect(interrupted).toHaveBeenCalledTimes(2);
  });

  it("pauses further authors after GitHub rate limits the client", async () => {
    const resolve = vi.fn(() =>
      Effect.fail(new AvatarUnavailable({ retryAt: Date.now() + 60_000 })),
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
      await model.dispose();
    }
  });
});
