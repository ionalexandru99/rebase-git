import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "#tests-support/render.tsx";
import {
  AuthorAvatar,
  AuthorAvatars,
} from "#web/features/author-avatars/author-avatar.tsx";
import { browserAvatarStore } from "#web/features/author-avatars/author-avatar-store.ts";

const github = { provider: "github", owner: "alex", name: "rebase" } as const;
afterEach(() => vi.unstubAllGlobals());

function commitBy(email: string) {
  return {
    oid: "a".repeat(40),
    author: {
      name: "Alexandru Ion",
      email,
      timestampSeconds: 0,
      timezoneOffsetMinutes: 0,
    },
  };
}

describe("author avatar", () => {
  it("keeps an in-flight lookup when a refresh replaces the commit object", async () => {
    const commit = commitBy("refresh@example.test");
    const interrupted = vi.fn();
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>(() => {
          init.signal?.addEventListener("abort", interrupted);
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const screen = await render(
      <AuthorAvatars repository={github}>
        <AuthorAvatar commit={commit} />
      </AuthorAvatars>,
    );
    await expect.poll(() => fetch).toHaveBeenCalledOnce();

    await screen.rerender(
      <AuthorAvatars repository={github}>
        <AuthorAvatar commit={structuredClone(commit)} />
      </AuthorAvatars>,
    );

    expect(interrupted).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    await expect.element(screen.getByText("AI", { exact: true })).toBeVisible();
  });

  it("shows a stored avatar without a request and restores initials if the image fails", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    browserAvatarStore.save("github", "stored@example.test", {
      url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
      expires: Date.now() + 60_000,
    });
    const screen = await render(
      <AuthorAvatars repository={github}>
        <AuthorAvatar commit={commitBy("stored@example.test")} />
      </AuthorAvatars>,
    );
    await expect.poll(() => document.querySelector("img")).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    document.querySelector("img")?.dispatchEvent(new Event("error"));
    await expect.element(screen.getByText("AI", { exact: true })).toBeVisible();
  });

  it("does not contact anything for repositories on other hosts", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const screen = await render(
      <AuthorAvatars repository={undefined}>
        <AuthorAvatar commit={commitBy("elsewhere@example.test")} />
      </AuthorAvatars>,
    );
    await expect.element(screen.getByText("AI", { exact: true })).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });
});
