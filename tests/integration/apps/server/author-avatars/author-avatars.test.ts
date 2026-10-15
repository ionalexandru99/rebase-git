import { createHash } from "node:crypto";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { AuthorAvatarsApi } from "#contracts/author-avatars/author-avatars.contract.ts";
import type { AvatarImages } from "#server/features/author-avatars/author-avatars.ts";
import type { GitHostClients } from "#server/features/source-control/source-control.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { fakeAvatarImages } from "#tests-support/git-hosts/avatar-images.ts";
import { fakeAzureDevOps } from "#tests-support/git-hosts/azure-devops.ts";
import { fakeBitbucket } from "#tests-support/git-hosts/bitbucket.ts";
import { fakeGitHub } from "#tests-support/git-hosts/github.ts";
import { openTestEnvironment } from "#tests-support/server.ts";

const author = "rebase@example.test";
const image = "data:image/png;base64,iVBORw0KGgo=";
const gravatar = `https://gravatar.com/avatar/${createHash("sha256").update(author).digest("hex")}?s=40&d=404`;

async function avatarsFixture(
  origin: string,
  gitHosts: Partial<GitHostClients>,
  avatarImages: AvatarImages,
  { pushed = true } = {},
) {
  const environment = await openTestEnvironment({ gitHosts, avatarImages });
  const repositoryPath = join(environment.home, "repository");
  await createRepository(repositoryPath);
  await git(repositoryPath, "remote", "add", "origin", origin);
  if (pushed)
    await git(repositoryPath, "update-ref", "refs/remotes/origin/main", "HEAD");
  const repositoryId = (await environment.remember(repositoryPath)).id;
  const service = environment.routes(AuthorAvatarsApi);
  return {
    commit: await git(repositoryPath, "rev-parse", "HEAD"),
    read: () =>
      Effect.runPromise(
        service.read({ repositoryId, email: "Rebase@Example.test" }),
      ),
  };
}

describe("author avatars", () => {
  it("reads a private GitHub author's avatar through gh once and then from the cache", async () => {
    const url = "https://avatars.githubusercontent.com/u/7?s=40";
    const { github, requests } = fakeGitHub(
      {},
      { avatar: { email: author, url } },
    );
    const { avatarImages, downloads } = fakeAvatarImages({ [url]: image });
    const f = await avatarsFixture(
      "git@github.com:octo/private.git",
      { github },
      avatarImages,
    );

    await expect(f.read()).resolves.toBe(image);
    await expect(f.read()).resolves.toBe(image);

    expect(requests).toEqual([
      { owner: "octo", name: "private", oid: f.commit },
    ]);
    expect(downloads).toEqual([{ url }]);
  });

  it("downloads an Azure DevOps avatar with the signed-in account", async () => {
    const url = "https://dev.azure.com/org/_apis/GraphProfile/MemberAvatars/a";
    const { azureDevOps } = fakeAzureDevOps(
      {},
      { commitAuthor: { email: author, imageUrl: url } },
    );
    const { avatarImages, downloads } = fakeAvatarImages({ [url]: image });
    const f = await avatarsFixture(
      "https://dev.azure.com/org/project/_git/private",
      { azureDevOps },
      avatarImages,
    );

    await expect(f.read()).resolves.toBe(image);
    expect(downloads).toEqual([{ url, authorization: "Bearer token" }]);
  });

  it("falls back to Gravatar and remembers an author the host has no avatar for", async () => {
    const { avatarImages, downloads } = fakeAvatarImages({});
    const f = await avatarsFixture(
      "git@github.com:octo/private.git",
      { github: fakeGitHub({}).github },
      avatarImages,
    );

    await expect(f.read()).resolves.toBeNull();
    await expect(f.read()).resolves.toBeNull();
    expect(downloads).toEqual([{ url: gravatar }]);
  });

  it("does not ask the host about unpushed commits or remember the Gravatar answer", async () => {
    const { github, requests } = fakeGitHub({});
    const { avatarImages, downloads } = fakeAvatarImages({ [gravatar]: image });
    const f = await avatarsFixture(
      "git@github.com:octo/private.git",
      { github },
      avatarImages,
      { pushed: false },
    );

    await expect(f.read()).resolves.toBe(image);
    await expect(f.read()).resolves.toBe(image);
    expect(requests).toEqual([]);
    expect(downloads).toEqual([{ url: gravatar }, { url: gravatar }]);
  });

  it("uses Gravatar without remembering it while Bitbucket has no token", async () => {
    const { bitbucket, requests } = fakeBitbucket();
    const { avatarImages, downloads } = fakeAvatarImages({ [gravatar]: image });
    const f = await avatarsFixture(
      "git@bitbucket.org:team/private.git",
      { bitbucket },
      avatarImages,
    );

    await expect(f.read()).resolves.toBe(image);
    await expect(f.read()).resolves.toBe(image);
    expect(requests).toEqual([]);
    expect(downloads).toEqual([{ url: gravatar }, { url: gravatar }]);
  });

  it("asks the host again after it could not answer", async () => {
    const { github, requests } = fakeGitHub(null);
    const f = await avatarsFixture(
      "git@github.com:octo/private.git",
      { github },
      fakeAvatarImages({}).avatarImages,
    );

    await expect(f.read()).rejects.toEqual({
      _tag: "AuthorAvatarUnavailable",
    });
    await expect(f.read()).rejects.toEqual({
      _tag: "AuthorAvatarUnavailable",
    });
    expect(requests).toHaveLength(2);
  });
});
