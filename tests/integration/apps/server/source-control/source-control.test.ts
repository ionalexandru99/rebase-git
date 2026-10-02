import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { PullRequestsApi } from "#contracts/pull-requests/pull-requests.contract.ts";
import { SourceControlApi } from "#contracts/source-control/source-control.contract.ts";
import { createRepository, git } from "#tests-support/git.ts";
import {
  fakeAzureDevOps,
  fakeGitHub,
  openTestEnvironment,
} from "#tests-support/server.ts";

describe("source control", () => {
  it("reports Git, the GitHub and Azure DevOps logins and the hosts that are coming soon", async () => {
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
        account: "octo",
      },
      { _tag: "ComingSoon", kind: "gitlab" },
      {
        _tag: "SignedIn",
        kind: "azure-devops",
        enabled: true,
        version: "azure-cli 2.78.0",
        account: "octo@example.com",
      },
      { _tag: "ComingSoon", kind: "bitbucket" },
      { _tag: "ComingSoon", kind: "forgejo" },
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
});

async function fixture(tool: Parameters<typeof fakeGitHub>[1] = {}) {
  const { github, requests } = fakeGitHub({ main: [{ number: 1 }] }, tool);
  const environment = await openTestEnvironment({
    github,
    azureDevOps: fakeAzureDevOps({}).azureDevOps,
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
    discover: () => Effect.runPromise(sourceControl.discover(undefined)),
    setEnabled: (enabled: boolean) =>
      Effect.runPromise(
        sourceControl.setHostEnabled({ kind: "github", enabled }),
      ),
    pullRequests: () => Effect.runPromise(pullRequests.list({ repositoryId })),
  };
}
