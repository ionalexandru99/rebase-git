import { join } from "node:path";
import { Effect } from "effect";
import { PullRequestsApi } from "#contracts/pull-requests/pull-requests.contract.ts";
import { SourceControlApi } from "#contracts/source-control/source-control.contract.ts";
import type { GitHostClients } from "#server/features/source-control/source-control.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";

export async function pullRequestsFixture(
  remotes: Readonly<Record<string, string>>,
  gitHosts: Partial<GitHostClients>,
) {
  const environment = await openTestEnvironment({ gitHosts });
  const repositoryPath = join(environment.home, "repository");
  await createRepository(repositoryPath, {
    branches: ["topic", "mirrored", "elsewhere"],
  });
  for (const [remote, url] of Object.entries(remotes))
    await git(repositoryPath, "remote", "add", remote, url);
  const repositoryId = (await environment.remember(repositoryPath)).id;
  const service = environment.routes(PullRequestsApi);
  return {
    repositoryId,
    repositoryPath,
    events: environment.events,
    routes: environment.routes,
    sourceControl: environment.routes(SourceControlApi),
    list: () => Effect.runPromise(service.list({ repositoryId })),
    find: (number: number) =>
      Effect.runPromise(service.find({ repositoryId, number })),
    link: (branch: string, number: number, linked = true) =>
      Effect.runPromise(
        service.link({
          repositoryId,
          worktreePath: repositoryPath,
          branch,
          number,
          linked,
        }),
      ),
    track: async (branch: string, remote: string, head: string) => {
      await git(repositoryPath, "config", `branch.${branch}.remote`, remote);
      await git(
        repositoryPath,
        "config",
        `branch.${branch}.merge`,
        `refs/heads/${head}`,
      );
    },
  };
}
