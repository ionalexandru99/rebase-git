import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { PullRequestsApi } from "#contracts/pull-requests/pull-requests.contract.ts";
import { SourceControlApi } from "#contracts/source-control/source-control.contract.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { fakeAzureDevOps } from "#tests-support/git-hosts/azure-devops.ts";
import { fakeBitbucket } from "#tests-support/git-hosts/bitbucket.ts";
import { fakeForgejo } from "#tests-support/git-hosts/forgejo.ts";
import { fakeGitHub } from "#tests-support/git-hosts/github.ts";
import { fakeGitLab } from "#tests-support/git-hosts/gitlab.ts";
import { openTestEnvironment } from "#tests-support/server.ts";

describe("source control", () => {
  it("reports Git, the logins of every host and the Bitbucket token", async () => {
    const f = await fixture();

    const { git: gitStatus, hosts } = await f.discover();

    expect(gitStatus).toEqual({
      _tag: "Available",
      version: expect.stringMatching(/^git version /),
    });
    expect(hosts).toEqual([
      {
        _tag: "SignedIn",
        kind: "github",
        enabled: true,
        version: "gh version 2.101.0 (2026-09-15)",
        accounts: [{ host: "github.com", account: "octo" }],
      },
      {
        _tag: "SignedIn",
        kind: "gitlab",
        enabled: true,
        version: "glab 1.120.0 (78790114c)",
        accounts: [
          { host: "gitlab.com", account: "tanuki" },
          { host: "git.example.com", account: "tanuki" },
        ],
      },
      {
        _tag: "SignedIn",
        kind: "azure-devops",
        enabled: true,
        version: "azure-cli 2.78.0",
        accounts: [{ host: "dev.azure.com", account: "octo@example.com" }],
      },
      { _tag: "Token", kind: "bitbucket", enabled: true, saved: null },
      {
        _tag: "SignedIn",
        kind: "forgejo",
        enabled: true,
        version: "tea 0.16.0",
        accounts: [
          { host: "codeberg.org", account: "forge" },
          { host: "git.example.com", account: "forge" },
        ],
      },
    ]);
  });

  it("lists GitHub repositories to clone over the configured protocol, without the ones already open", async () => {
    const f = await fixture({
      github: {
        protocol: "ssh",
        repositories: [
          { name: "octo/rebase" },
          { name: "octo/storefront", private: true },
        ],
      },
    });

    const hosts = await f.cloneable();

    expect(hosts).toEqual([
      {
        kind: "github",
        host: "github.com",
        account: "octo",
        repositories: [
          {
            name: "octo/storefront",
            url: "git@github.com:octo/storefront.git",
            private: true,
            updatedAt: "2026-10-01T10:00:00.000Z",
          },
        ],
      },
    ]);
  });

  it("lists GitLab repositories for every signed-in server over its own protocol, skipping paths too long to show", async () => {
    const f = await fixture({
      github: { account: null },
      gitlab: {
        accounts: {
          "gitlab.com": "tanuki",
          "git.example.com": "tanuki",
          "broken.example.com": "tanuki",
        },
        protocols: { "git.example.com": "https" },
        repositories: {
          "gitlab.com": [
            { name: "group/sub/rebase", private: true },
            { name: `group/${"deep/".repeat(60)}project` },
          ],
          "git.example.com": [{ name: "team/storefront" }],
        },
      },
    });

    const hosts = await f.cloneable();

    expect(hosts).toEqual([
      {
        kind: "gitlab",
        host: "gitlab.com",
        account: "tanuki",
        repositories: [
          {
            name: "group/sub/rebase",
            url: "git@gitlab.com:group/sub/rebase.git",
            private: true,
            updatedAt: "2026-10-01T10:00:00.000Z",
          },
        ],
      },
      {
        kind: "gitlab",
        host: "git.example.com",
        account: "tanuki",
        repositories: [
          {
            name: "team/storefront",
            url: "https://git.example.com/team/storefront.git",
            private: false,
            updatedAt: "2026-10-01T10:00:00.000Z",
          },
        ],
      },
    ]);
  });

  it("lists Forgejo repositories for every tea login, over SSH where tea clones with a key", async () => {
    const f = await fixture({
      forgejo: {
        logins: [
          {
            url: "https://codeberg.org",
            user: "forge",
            sshKey: "/home/forge/.ssh/id_ed25519",
          },
          { url: "https://git.example.com:3000", user: "forge" },
        ],
        repositories: [{ name: "team/site", description: "Our website" }],
      },
    });

    const hosts = await f.cloneable();

    expect(hosts.filter(({ kind }) => kind === "forgejo")).toEqual([
      {
        kind: "forgejo",
        host: "codeberg.org",
        account: "forge",
        repositories: [
          {
            name: "team/site",
            url: "git@codeberg.org:team/site.git",
            private: false,
            description: "Our website",
            updatedAt: "2026-10-01T10:00:00.000Z",
          },
        ],
      },
      {
        kind: "forgejo",
        host: "git.example.com:3000",
        account: "forge",
        repositories: [
          {
            name: "team/site",
            url: "https://git.example.com:3000/team/site.git",
            private: false,
            description: "Our website",
            updatedAt: "2026-10-01T10:00:00.000Z",
          },
        ],
      },
    ]);
  });

  it("lists Azure DevOps repositories to clone from every organization over SSH, skipping disabled ones", async () => {
    const f = await fixture({
      azureDevOps: {
        organizations: {
          acme: [
            { project: "Rebase App", name: "rebase" },
            { project: "Rebase App", name: "archive", disabled: true },
          ],
          octo: [
            { project: "Tools", name: "scripts", public: true, ssh: false },
          ],
        },
      },
    });

    const hosts = await f.cloneable();

    expect(hosts.find(({ kind }) => kind === "azure-devops")).toEqual({
      kind: "azure-devops",
      host: "dev.azure.com",
      account: "octo@example.com",
      repositories: [
        {
          name: "acme/Rebase App/rebase",
          url: "git@ssh.dev.azure.com:v3/acme/Rebase%20App/rebase",
          private: true,
        },
        {
          name: "octo/Tools/scripts",
          url: "https://octo@dev.azure.com/octo/Tools/_git/scripts",
          private: false,
        },
      ],
    });
  });

  it("lists the repositories of every Bitbucket workspace an API token reaches over SSH, newest first", async () => {
    const f = await fixture({
      bitbucket: {
        repositories: [
          {
            name: "acme/storefront",
            updatedOn: "2026-09-01T08:00:00.000000+00:00",
          },
          {
            name: "octo/notes",
            private: true,
            updatedOn: "2026-10-02T09:30:00.654321+00:00",
          },
        ],
      },
    });
    const bitbucket = () =>
      f
        .cloneable()
        .then((hosts) => hosts.filter(({ kind }) => kind === "bitbucket"));
    await f.saveToken({
      _tag: "ApiToken",
      email: "octo@example.com",
      token: "api-token",
    });

    expect(await bitbucket()).toEqual([
      {
        kind: "bitbucket",
        host: "bitbucket.org",
        account: "octo",
        repositories: [
          {
            name: "octo/notes",
            url: "git@bitbucket.org:octo/notes.git",
            private: true,
            updatedAt: "2026-10-02T09:30:00.654Z",
          },
          {
            name: "acme/storefront",
            url: "git@bitbucket.org:acme/storefront.git",
            private: false,
            updatedAt: "2026-09-01T08:00:00.000Z",
          },
        ],
      },
    ]);

    await f.saveToken({ _tag: "AccessToken", token: "access-token" });

    expect(await bitbucket()).toEqual([]);
  });

  it("reads at most ten repository pages across all Bitbucket workspaces", async () => {
    const f = await fixture({
      bitbucket: {
        repositories: [
          { name: "octo/notes" },
          ...Array.from({ length: 1_200 }, (_, index) => ({
            name: `acme/repository-${index}`,
          })),
        ],
      },
    });
    await f.saveToken({
      _tag: "ApiToken",
      email: "octo@example.com",
      token: "api-token",
    });

    const hosts = await f.cloneable();
    const repositories =
      hosts.find(({ kind }) => kind === "bitbucket")?.repositories ?? [];

    expect(repositories).toHaveLength(901);
    expect(repositories.map(({ name }) => name)).toContain("octo/notes");
    expect(
      f.bitbucketRequests.filter(({ url }) =>
        url.includes("/2.0/repositories/"),
      ),
    ).toHaveLength(10);
  });

  it("reports a missing or signed out GitHub CLI", async () => {
    const missing = await fixture({ github: { version: null } });
    const signedOut = await fixture({ github: { account: null } });

    expect((await missing.discover()).hosts[0]).toEqual({
      _tag: "Missing",
      kind: "github",
      enabled: true,
    });
    expect((await signedOut.discover()).hosts[0]).toEqual({
      _tag: "SignedOut",
      kind: "github",
      enabled: true,
      version: "gh version 2.101.0 (2026-09-15)",
    });
  });

  it("stops asking GitHub for pull requests while GitHub is switched off", async () => {
    const f = await fixture();
    const changes: unknown[] = [];
    f.environment.events.subscribe((sequence) => changes.push(sequence));

    await f.setEnabled(false);

    await expect(f.pullRequests()).resolves.toEqual([]);
    expect(f.requests).toEqual([]);
    expect((await f.discover()).hosts[0]).toMatchObject({ enabled: false });
    expect(changes).toHaveLength(1);

    await f.setEnabled(true);

    await expect(f.pullRequests()).resolves.toEqual([
      expect.objectContaining({ branch: "main" }),
    ]);
  });

  it("checks an Atlassian API token with Bitbucket before saving it, and keeps an access token as given", async () => {
    const f = await fixture({
      bitbucket: {
        scopes: ["read:repository:bitbucket", "read:user:bitbucket"],
      },
    });
    const bitbucket = () =>
      f
        .discover()
        .then(({ hosts }) => hosts.find(({ kind }) => kind === "bitbucket"));

    await f.saveToken({
      _tag: "ApiToken",
      email: "octo@example.com",
      token: "api-token",
    });

    expect(await bitbucket()).toMatchObject({
      saved: {
        _tag: "ApiToken",
        email: "octo@example.com",
        account: "octo",
        missingScopes: [
          "read:pullrequest:bitbucket",
          "read:workspace:bitbucket",
        ],
      },
    });
    expect(f.bitbucketRequests).toEqual(
      [
        "https://api.bitbucket.org/2.0/user",
        "https://api.bitbucket.org/2.0/user/workspaces?pagelen=1&fields=values.workspace.slug",
        "https://api.bitbucket.org/2.0/user",
      ].map((url) => ({
        url,
        authorization: `Basic ${btoa("octo@example.com:api-token")}`,
      })),
    );

    await f.saveToken({ _tag: "AccessToken", token: "access-token" });

    expect(await bitbucket()).toMatchObject({ saved: { _tag: "AccessToken" } });
    expect(f.bitbucketRequests).toHaveLength(3);

    await f.removeToken();

    expect(await bitbucket()).toMatchObject({ saved: null });
  });

  it.each([{ userStatus: 403 }, { workspacesStatus: 403 }])(
    "rejects an API token that cannot read the Atlassian account or its workspaces (%o)",
    async (statuses) => {
      const f = await fixture({ bitbucket: statuses });

      await expect(
        f.saveToken({
          _tag: "ApiToken",
          email: "octo@example.com",
          token: "x",
        }),
      ).rejects.toEqual({
        _tag: "BitbucketTokenRejected",
        reason: "MissingScope",
      });
      expect(
        (await f.discover()).hosts.find(({ kind }) => kind === "bitbucket"),
      ).toMatchObject({ saved: null });
    },
  );
});

async function fixture({
  github: githubTool = {},
  bitbucket: bitbucketUser = {},
  gitlab = {
    accounts: { "gitlab.com": "tanuki", "git.example.com": "tanuki" },
  },
  forgejo = {},
  azureDevOps,
}: {
  readonly github?: Parameters<typeof fakeGitHub>[1];
  readonly bitbucket?: Parameters<typeof fakeBitbucket>[1];
  readonly gitlab?: Parameters<typeof fakeGitLab>[1];
  readonly forgejo?: Parameters<typeof fakeForgejo>[1];
  readonly azureDevOps?: Parameters<typeof fakeAzureDevOps>[1];
} = {}) {
  const { github, requests } = fakeGitHub(
    { main: [{ number: 1 }] },
    githubTool,
  );
  const bitbucket = fakeBitbucket({}, bitbucketUser);
  const environment = await openTestEnvironment({
    gitHosts: {
      bitbucket: bitbucket.bitbucket,
      github,
      azureDevOps: fakeAzureDevOps(
        azureDevOps === undefined ? null : {},
        azureDevOps,
      ).azureDevOps,
      gitlab: fakeGitLab(null, gitlab).gitlab,
      forgejo: fakeForgejo(null, {
        logins: [
          { url: "https://codeberg.org", user: "forge" },
          { url: "https://git.example.com", user: "forge" },
        ],
        ...forgejo,
      }).forgejo,
    },
  });
  const repositoryPath = join(environment.home, "repository");
  await createRepository(repositoryPath);
  await git(
    repositoryPath,
    "remote",
    "add",
    "origin",
    "git@github.com:octo/rebase.git",
  );
  await git(repositoryPath, "config", "branch.main.remote", "origin");
  await git(repositoryPath, "config", "branch.main.merge", "refs/heads/main");
  const repositoryId = (await environment.remember(repositoryPath)).id;
  const sourceControl = environment.routes(SourceControlApi);
  const pullRequests = environment.routes(PullRequestsApi);
  return {
    environment,
    requests,
    bitbucketRequests: bitbucket.requests,
    saveToken: (
      token: Parameters<typeof sourceControl.saveBitbucketToken>[0],
    ) => Effect.runPromise(sourceControl.saveBitbucketToken(token)),
    removeToken: () =>
      Effect.runPromise(sourceControl.removeBitbucketToken(undefined)),
    discover: () => Effect.runPromise(sourceControl.discover(undefined)),
    cloneable: () => Effect.runPromise(sourceControl.cloneable(undefined)),
    setEnabled: (enabled: boolean) =>
      Effect.runPromise(
        sourceControl.setHostEnabled({ kind: "github", enabled }),
      ),
    pullRequests: () => Effect.runPromise(pullRequests.list({ repositoryId })),
  };
}
