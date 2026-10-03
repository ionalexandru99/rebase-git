import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { PullRequestsApi } from "#contracts/pull-requests/pull-requests.contract.ts";
import { SourceControlApi } from "#contracts/source-control/source-control.contract.ts";
import { createRepository, git } from "#tests-support/git.ts";
import {
  fakeAzureDevOps,
  fakeBitbucket,
  fakeForgejo,
  fakeGitHub,
  fakeGitLab,
} from "#tests-support/git-hosts.ts";
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

  it("reports a missing or signed out GitHub CLI", async () => {
    const missing = await fixture({ version: null });
    const signedOut = await fixture({ account: null });

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
    const f = await fixture();
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
      saved: { _tag: "ApiToken", email: "octo@example.com", account: "octo" },
    });
    expect(f.bitbucketRequests).toEqual([
      {
        url: "https://api.bitbucket.org/2.0/user",
        authorization: `Basic ${btoa("octo@example.com:api-token")}`,
      },
    ]);

    await f.saveToken({ _tag: "AccessToken", token: "access-token" });

    expect(await bitbucket()).toMatchObject({ saved: { _tag: "AccessToken" } });
    expect(f.bitbucketRequests).toHaveLength(1);

    await f.removeToken();

    expect(await bitbucket()).toMatchObject({ saved: null });
  });

  it("rejects an API token that cannot read the Atlassian account", async () => {
    const f = await fixture({}, { userStatus: 403 });

    await expect(
      f.saveToken({ _tag: "ApiToken", email: "octo@example.com", token: "x" }),
    ).rejects.toEqual({
      _tag: "BitbucketTokenRejected",
      reason: "MissingScope",
    });
    expect(
      (await f.discover()).hosts.find(({ kind }) => kind === "bitbucket"),
    ).toMatchObject({ saved: null });
  });
});

async function fixture(
  tool: Parameters<typeof fakeGitHub>[1] = {},
  bitbucketUser: Parameters<typeof fakeBitbucket>[1] = {},
) {
  const { github, requests } = fakeGitHub({ main: [{ number: 1 }] }, tool);
  const bitbucket = fakeBitbucket({}, bitbucketUser);
  const environment = await openTestEnvironment({
    bitbucket: bitbucket.bitbucket,
    github,
    azureDevOps: fakeAzureDevOps({}).azureDevOps,
    gitlab: fakeGitLab(null, {
      accounts: { "gitlab.com": "tanuki", "git.example.com": "tanuki" },
    }).gitlab,
    forgejo: fakeForgejo(null, {
      logins: [
        { url: "https://codeberg.org", user: "forge" },
        { url: "https://git.example.com", user: "forge" },
      ],
    }).forgejo,
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
    setEnabled: (enabled: boolean) =>
      Effect.runPromise(
        sourceControl.setHostEnabled({ kind: "github", enabled }),
      ),
    pullRequests: () => Effect.runPromise(pullRequests.list({ repositoryId })),
  };
}
