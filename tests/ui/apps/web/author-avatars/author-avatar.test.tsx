import { describe, expect, it } from "vite-plus/test";
import { AuthorAvatarsApi } from "#contracts/author-avatars/author-avatars.contract.ts";
import type { RouteInput } from "#contracts/environment-connection/environment-route.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import { repositoryId, repositoryScope } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { AuthorAvatar } from "#web/features/author-avatars/author-avatar.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const pixel =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

async function renderAvatar(image: string | null) {
  const asked: RouteInput<typeof AuthorAvatarsApi.read>[] = [];
  const screen = await render(
    <RepositoryScopeProvider scope={repositoryScope()}>
      <AuthorAvatar
        author={{ name: "Alexandru Ion", email: "Alex@Example.test" }}
      />
    </RepositoryScopeProvider>,
    {
      environment: {
        requests: fakeRequests(
          respond(AuthorAvatarsApi.read, (input) => {
            asked.push(input);
            return image;
          }),
        ),
      },
    },
  );
  return { asked, screen };
}

describe("author avatar", () => {
  it("shows the avatar the server found for the author", async () => {
    const { asked } = await renderAvatar(pixel);

    await expect.poll(() => document.querySelector("img")?.src).toBe(pixel);
    expect(asked).toEqual([{ repositoryId, email: "alex@example.test" }]);
  });

  it("shows initials when the author has no avatar", async () => {
    const { screen } = await renderAvatar(null);

    await expect.element(screen.getByText("AI", { exact: true })).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
  });

  it("falls back to initials when the image cannot be shown", async () => {
    const { screen } = await renderAvatar(pixel);
    await expect.poll(() => document.querySelector("img")).not.toBeNull();

    document.querySelector("img")?.dispatchEvent(new Event("error"));

    await expect.element(screen.getByText("AI", { exact: true })).toBeVisible();
  });
});
