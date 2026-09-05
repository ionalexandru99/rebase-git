import { Deferred, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { githubAvatarSource } from "#web/features/author-avatars/github-avatar-source";
import {
  AuthorAvatar,
  AuthorAvatars,
} from "#web/features/author-avatars/index";

const commit = {
  oid: "a".repeat(40),
  author: {
    name: "Alexandru Ion",
    email: "alex@example.test",
    timestampSeconds: 0,
    timezoneOffsetMinutes: 0,
  },
};
afterEach(() => vi.restoreAllMocks());

describe("author avatar", () => {
  it("shows initials immediately and restores them if the resolved image fails", async () => {
    const result = Deferred.makeUnsafe<string | undefined>();
    vi.spyOn(githubAvatarSource, "resolve").mockReturnValue(
      Deferred.await(result),
    );
    const screen = await render(
      <AuthorAvatars repository={{ owner: "alex", name: "rebase" }}>
        <AuthorAvatar commit={commit} />
      </AuthorAvatars>,
    );
    await expect.element(screen.getByText("AI", { exact: true })).toBeVisible();
    await Effect.runPromise(
      Deferred.succeed(
        result,
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
      ),
    );
    await vi.waitFor(() =>
      expect(githubAvatarSource.resolve).toHaveBeenCalledOnce(),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("img")).not.toBeNull(),
    );
    document.querySelector("img")?.dispatchEvent(new Event("error"));
    await expect.element(screen.getByText("AI", { exact: true })).toBeVisible();
  });

  it("does not contact GitHub for repositories on other hosts", async () => {
    const resolve = vi.spyOn(githubAvatarSource, "resolve");
    const screen = await render(
      <AuthorAvatars repository={undefined}>
        <AuthorAvatar commit={commit} />
      </AuthorAvatars>,
    );
    await expect.element(screen.getByText("AI", { exact: true })).toBeVisible();
    expect(resolve).not.toHaveBeenCalled();
  });
});
