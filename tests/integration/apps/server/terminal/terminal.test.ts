import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { TerminalsApi } from "#contracts/terminal/terminal.contract.ts";
import { createRepository } from "#tests-support/git.ts";
import { openTestServer } from "#tests-support/server.ts";
import { environmentSubscriptions } from "#web/platform/environment/environment-connection.ts";

it("runs the user's shell in the worktree over the environment socket until it exits", async () => {
  const server = await openTestServer();
  const worktreePath = join(server.home, "repository");
  await createRepository(worktreePath);
  const requests = server.requests(server.owner);
  const { id: repositoryId } = await requests(RepositoryCatalogApi.remember, {
    path: worktreePath,
  });
  const worktree = { repositoryId, worktreePath };
  const subscribe = environmentSubscriptions(
    (await server.connect(server.owner)).rpc,
  );

  const terminal = await requests(TerminalsApi.open, {
    ...worktree,
    cols: 200,
    rows: 40,
  });
  let output = "";
  let exited = false;
  const attached = subscribe(
    TerminalsApi.attach,
    { id: terminal.id, since: 0 },
    (chunk) => {
      if (chunk._tag === "Exited") exited = true;
      else output += chunk.data;
    },
    new AbortController().signal,
  );
  await requests(TerminalsApi.write, {
    id: terminal.id,
    data: "git rev-parse --is-inside-work-tree\r",
  });

  await expect.poll(() => output).toContain("true");
  expect(await requests(TerminalsApi.list, worktree)).toEqual({
    terminals: [terminal],
  });

  await requests(TerminalsApi.write, { id: terminal.id, data: "exit\r" });
  await attached;
  expect(exited).toBe(true);
  expect(await requests(TerminalsApi.list, worktree)).toEqual({
    terminals: [],
  });
});
