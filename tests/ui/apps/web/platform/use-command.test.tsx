import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import { RepositoryTagsApi } from "#contracts/repository-refs/repository-tags.contract.ts";
import {
  fakeRequests,
  idleOperation,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import { repositoryScope } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

const scope = repositoryScope();

it("fills the repository target, answers rejections as results and rereads the repository after success", async () => {
  // Arrange
  const created = vi.fn();
  const operationReads = vi.fn(idleOperation.respond);
  const requests = fakeRequests(
    respond(RepositoryOperationsApi.read, operationReads),
    respond(RepositoryTagsApi.create, async (command) => {
      created(command);
      if (command.name === "taken")
        throw rejected({ _tag: "TagRejected", reason: "Exists" });
      return { name: command.name, target: command.target };
    }),
  );
  await render(
    <RepositoryScopeProvider scope={scope}>
      <CreateTag />
    </RepositoryScopeProvider>,
    { environment: { requests } },
  );
  await expect.poll(() => operationReads.mock.calls.length).toBe(1);

  // Act
  await page.getByRole("button", { name: "Create taken" }).click();

  // Assert
  await expect.element(page.getByRole("alert")).toHaveTextContent("Rejected");
  expect(created).toHaveBeenLastCalledWith({
    repositoryId: scope.repositoryId,
    worktreePath: scope.worktreePath,
    name: "taken",
    target: "a".repeat(40),
  });

  // Act
  const readsBefore = operationReads.mock.calls.length;
  await page.getByRole("button", { name: "Create v1" }).click();

  // Assert
  await expect.element(page.getByRole("alert")).toHaveTextContent("Ok");
  await expect
    .poll(() => operationReads.mock.calls.length)
    .toBeGreaterThan(readsBefore);
});

function CreateTag() {
  const create = useCommand(RepositoryTagsApi.create);
  const [outcome, setOutcome] = useState<string>();
  useEnvironmentQuery(
    RepositoryOperationsApi.read,
    { repositoryId: scope.repositoryId, worktreePath: scope.worktreePath },
    { changes: "index" },
  );
  const run = async (name: string) => {
    const result = await create.run({ name, target: "a".repeat(40) });
    setOutcome(
      result._tag === "Ok"
        ? "Ok"
        : `${result._tag}: ${describeFailure(result)}`,
    );
  };
  return (
    <>
      <button type="button" onClick={() => void run("taken")}>
        Create taken
      </button>
      <button type="button" onClick={() => void run("v1")}>
        Create v1
      </button>
      {outcome === undefined ? null : <p role="alert">{outcome}</p>}
    </>
  );
}
