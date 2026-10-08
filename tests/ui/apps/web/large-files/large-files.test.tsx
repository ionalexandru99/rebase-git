import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type { ChangedFile } from "#contracts/repository-changes/repository-changes.contract.ts";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import type { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";
import {
  type LargeFiles,
  type LfsLocks,
  RepositoryLfsApi,
  type SetLock,
  type SetTracked,
} from "#contracts/repository-lfs/repository-lfs.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import {
  changeDiff,
  changedFile,
  repositoryChanges,
  repositoryScope,
} from "#tests-support/fixtures.ts";
import { render, testChanges } from "#tests-support/render.tsx";
import { WorkingChanges } from "#web/features/working-changes/working-changes.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const model = {
  ...changedFile("art/hero.psd"),
  lfs: true,
} satisfies ChangedFile;
const ship = changedFile("models/ship.fbx", "?");

async function fixture({
  largeFiles = { installed: true, patterns: ["*.psd"] },
  locks = [],
  diff = changeDiff(model.path),
  download = async () => {},
}: {
  readonly largeFiles?: LargeFiles;
  readonly locks?: LfsLocks;
  readonly diff?: ChangeDiff;
  readonly download?: (progress: (percent: number) => void) => Promise<void>;
} = {}) {
  const tracked: SetTracked[] = [];
  const locked: SetLock[] = [];
  const repositoryId = crypto.randomUUID();
  const requests = fakeRequests(
    respond(RepositoryChangesApi.read, () =>
      repositoryChanges({ unstaged: [model, ship] }),
    ),
    respond(RepositoryChangesApi.diff, () => diff),
    respond(RepositoryLfsApi.read, () => largeFiles),
    respond(RepositoryLfsApi.locks, () => locks),
    respond(RepositoryLfsApi.setTracked, (input) => {
      tracked.push(input);
    }),
    respond(RepositoryLfsApi.setLock, (input) => {
      locked.push(input);
    }),
    respond(RepositoryLfsApi.download, (_input, { progress }) =>
      download((percent) => progress?.({ percent, largeFiles: true })),
    ),
  );
  await render(
    <RepositoryScopeProvider
      scope={repositoryScope({ repositoryId, worktreePath: "/repo" })}
    >
      <div
        className="dark text-foreground"
        style={{ width: 1100, height: 700 }}
      >
        <WorkingChanges
          target={{
            repositoryId,
            worktreePath: "/repo",
            draftKey: JSON.stringify([repositoryId, "/repo"]),
            active: true,
          }}
          writable
        />
      </div>
    </RepositoryScopeProvider>,
    {
      environment: { requests },
      queryClient: testChanges().queryClient,
    },
  );
  return { tracked, locked };
}

const row = (path: string) =>
  page.getByRole("button", { name: `Unstaged ${path}`, exact: true });

describe("large files in working changes", () => {
  it("tracks a file with Git LFS and shows and releases someone else's lock", async () => {
    const f = await fixture({
      locks: [{ path: model.path, owner: "bob", ours: false }],
    });

    await expect.element(page.getByText("bob")).toBeVisible();
    await row(ship.path).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Track with LFS" }).click();
    await page.getByRole("menuitem", { name: "*.fbx" }).click();
    await expect
      .poll(() => f.tracked)
      .toEqual([expect.objectContaining({ pattern: "*.fbx", tracked: true })]);
    await row(model.path).click({ button: "right" });
    await expect
      .element(page.getByRole("menuitem", { name: "Stop tracking with LFS" }))
      .toBeVisible();
    await page.getByRole("menuitem", { name: "Force unlock" }).click();
    await expect
      .poll(() => f.locked)
      .toEqual([
        expect.objectContaining({ path: model.path, action: "ForceUnlock" }),
      ]);
  });

  it("says Git LFS is missing and keeps large files from being staged", async () => {
    await fixture({ largeFiles: { installed: false, patterns: ["*.psd"] } });

    await expect
      .element(page.getByText("Git LFS isn't installed on this server."))
      .toBeVisible();
    await expect
      .element(
        page.getByRole("button", { name: `Stage ${model.path}`, exact: true }),
      )
      .toBeDisabled();
    await expect
      .element(
        page.getByRole("button", { name: `Stage ${ship.path}`, exact: true }),
      )
      .toBeEnabled();
    await page
      .getByRole("button", { name: "Collapse unstaged" })
      .click({ button: "right" });
    await expect
      .element(page.getByRole("menuitem", { name: "Stage all" }))
      .toHaveAttribute("aria-disabled", "true");
  });

  it("downloads a file that is not downloaded with large-file progress", async () => {
    const finished = Promise.withResolvers<void>();
    await fixture({
      diff: changeDiff(model.path, { kind: "missing", afterBytes: 3_000_000 }),
      download: async (progress) => {
        progress(40);
        await finished.promise;
      },
    });
    await row(model.path).click();

    await expect.element(page.getByText("Not downloaded")).toBeVisible();
    await page.getByRole("button", { name: "Download" }).click();
    await expect
      .element(page.getByRole("progressbar", { name: "Pulling large files" }))
      .toBeVisible();
    finished.resolve();
    await expect.element(page.getByText("Pulled large files")).toBeVisible();
  });
});
