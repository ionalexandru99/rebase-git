import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  AvatarUnavailable,
  avatarSourceFor,
} from "#web/features/author-avatars/author-avatar-providers.ts";

const author = { oid: "a".repeat(40), author: { email: "Alex@example.test" } };
const github = avatarSourceFor({
  provider: "github",
  owner: "alex",
  name: "rebase",
});
const gravatar =
  "https://gravatar.com/avatar/50eec718e0d28837a8e606b9d92d48a234a78739c25fd80feb47b81f72cb912c?s=40&d=404";
afterEach(() => vi.unstubAllGlobals());

function signal() {
  return new AbortController().signal;
}

function respond(...responses: Response[]) {
  const fetch = vi.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("author avatar providers", () => {
  it("uses the verified GitHub author without sending credentials", async () => {
    const fetch = respond(
      Response.json({
        author: {
          avatar_url: "https://avatars.githubusercontent.com/u/123?v=4",
        },
        commit: { author: { email: "alex@example.test" } },
      }),
    );
    expect(await github.resolve(author, signal())).toBe(
      "https://avatars.githubusercontent.com/u/123?v=4&s=40",
    );
    expect(fetch).toHaveBeenCalledOnce();
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
    "falls back to Gravatar for an unverified identity or image host",
    async (body) => {
      const fetch = respond(Response.json(body), new Response(null));
      expect(await github.resolve(author, signal())).toBe(gravatar);
      expect(fetch).toHaveBeenLastCalledWith(
        gravatar,
        expect.objectContaining({ method: "HEAD" }),
      );
    },
  );

  it("reads GitHub noreply addresses without a request", async () => {
    const fetch = respond();
    expect(
      await avatarSourceFor({ provider: "azure" }).resolve(
        {
          ...author,
          author: { email: "123+alex@users.noreply.github.com" },
        },
        signal(),
      ),
    ).toBe("https://avatars.githubusercontent.com/u/123?s=40");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps uploaded GitLab avatars and checks Gravatar itself otherwise", async () => {
    const gitlab = avatarSourceFor({ provider: "gitlab" });
    respond(
      Response.json({
        avatar_url: "https://gitlab.com/uploads/-/system/user/avatar/1/a.png",
      }),
    );
    expect(await gitlab.resolve(author, signal())).toBe(
      "https://gitlab.com/uploads/-/system/user/avatar/1/a.png?width=40",
    );
    respond(
      Response.json({
        avatar_url: "https://secure.gravatar.com/avatar/1?d=identicon",
      }),
      new Response(null, { status: 404 }),
    );
    expect(await gitlab.resolve(author, signal())).toBeUndefined();
  });

  it("skips Bitbucket initials images", async () => {
    const bitbucket = avatarSourceFor({
      provider: "bitbucket",
      owner: "alex",
      name: "rebase",
    });
    const host =
      "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net";
    const commit = (href: string) =>
      Response.json({
        author: {
          raw: "Alex <alex@example.test>",
          user: { links: { avatar: { href } } },
        },
      });
    respond(commit(`${host}/557058:abc/def/128`));
    expect(await bitbucket.resolve(author, signal())).toBe(
      `${host}/557058:abc/def/128`,
    );
    respond(commit(`${host}/initials/A-3.png`), new Response(null));
    expect(await bitbucket.resolve(author, signal())).toBe(gravatar);
  });

  it.each([
    new Response(null, {
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
    }),
    new Response(null, { status: 503 }),
  ])(
    "reports rate limits and outages instead of falling back",
    async (response) => {
      respond(response);
      await expect(github.resolve(author, signal())).rejects.toBeInstanceOf(
        AvatarUnavailable,
      );
    },
  );
});
