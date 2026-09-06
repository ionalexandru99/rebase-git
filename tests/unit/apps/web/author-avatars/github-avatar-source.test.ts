import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { githubAvatarSource } from "#web/features/author-avatars/github-avatar-source";

const repository = { owner: "alex", name: "rebase" };
const author = {
  oid: "a".repeat(40),
  author: {
    name: "Alexandru Ion",
    email: "alex@example.test",
    timestampSeconds: 0,
    timezoneOffsetMinutes: 0,
  },
};
afterEach(() => vi.unstubAllGlobals());

describe("GitHub commit avatars", () => {
  it("uses the verified author association without sending credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        author: {
          avatar_url: "https://avatars.githubusercontent.com/u/123?v=4",
        },
        commit: { author: { email: "alex@example.test" } },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      await Effect.runPromise(githubAvatarSource.resolve(repository, author)),
    ).toBe("https://avatars.githubusercontent.com/u/123?v=4&s=40");
    expect(fetch).toHaveBeenCalledWith(
      `https://api.github.com/repos/alex/rebase/commits/${author.oid}`,
      expect.objectContaining({
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    { author: null, commit: { author: { email: "alex@example.test" } } },
    {
      author: { avatar_url: "https://avatars.githubusercontent.com/u/123" },
      commit: { author: { email: "someone-else@example.test" } },
    },
    {
      author: { avatar_url: "https://other.example/photo" },
      commit: { author: { email: "alex@example.test" } },
    },
  ])(
    "keeps initials for an unverified identity or image host",
    async (body) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
      expect(
        await Effect.runPromise(githubAvatarSource.resolve(repository, author)),
      ).toBeUndefined();
    },
  );
});
