import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import {
  type RepositoryChanges,
  RepositoryChangesApi,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  CommitGraphFixture,
  history,
  historyOid,
  historyReader,
} from "#tests-support/commit-graph-fixture.tsx";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import {
  changedFile,
  repositoryChanges,
  repositoryScope,
} from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

async function renderGraph(changes: RepositoryChanges) {
  const openChanges = vi.fn();
  const read = vi.fn(() => changes);
  const screen = await render(
    <RepositoryScopeProvider scope={repositoryScope()}>
      <div style={{ height: 520, width: 900 }}>
        <CommitGraphFixture
          reader={historyReader({ commits: history(3), status: "ready" })}
          repositoryName="rebase-test"
          roots={[{ name: "main", oid: historyOid(0), type: "branch" }]}
          onOpenChanges={openChanges}
        />
      </div>
    </RepositoryScopeProvider>,
    {
      environment: {
        requests: fakeRequests(respond(RepositoryChangesApi.read, read)),
      },
    },
  );
  await expect
    .element(screen.getByRole("row", { name: /^Commit 0,/ }))
    .toBeVisible();
  await expect.poll(() => read.mock.calls.length).toBeGreaterThan(0);
  return { screen, openChanges };
}

describe("uncommitted changes row", () => {
  it("shows unstaged and staged counts and opens Diffs", async () => {
    const { screen, openChanges } = await renderGraph(
      repositoryChanges({
        head: historyOid(0),
        unstaged: [changedFile("src/a.ts"), changedFile("notes.md", "?")],
        staged: [changedFile("src/a.ts"), changedFile("src/b.ts", "A")],
      }),
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Uncommitted changes, 2 unstaged, 2 staged",
      }),
    );

    expect(openChanges).toHaveBeenCalledOnce();
  });

  it("stays hidden while the worktree is clean", async () => {
    const { screen } = await renderGraph(
      repositoryChanges({ head: historyOid(0) }),
    );

    await expect
      .element(screen.getByRole("button", { name: /^Uncommitted changes/ }))
      .not.toBeInTheDocument();
  });
});
