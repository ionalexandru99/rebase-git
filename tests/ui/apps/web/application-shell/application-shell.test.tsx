import {
  currentEnvironmentCapabilities,
  type EnvironmentDirectory,
  EnvironmentFilesystemHttpApi,
  encodeRepositoryHistoryBatch,
  encodeRepositoryHistoryPage,
  type RepositoryCatalogEntry,
  RepositoryCatalogHttpApi,
  type RepositoryCommit,
  type RepositoryRefs,
} from "@rebase/contracts";
import { EnvironmentHttpRejected } from "@rebase/environment-client";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import {
  fakeRequests,
  idleOperation,
  respond,
} from "#tests-ui/runtime/fake-requests";
import { fakeRpc } from "#tests-ui/runtime/fake-rpc";
import { render } from "#tests-ui/runtime/render";
import type { LocalEnvironmentSession } from "#web/app/environment/local-environment-session.contract";
import { ApplicationShell } from "#web-ui/app/shell/application-shell";
import { RepositoryWorkspace } from "#web-ui/app/workspace/repository-workspace";

describe("application shell", () => {
  it("opens repository settings from the list without opening its graph", async () => {
    const connected = await connectedSession();
    connected.finishSynchronization();
    await render(
      <ApplicationShell
        desktopUpdates={undefined}
        productVersion="test"
        repositoryFilesystem={undefined}
        session={connected.session}
      />,
    );
    await page
      .getByRole("button", { name: "Repository settings for rebase-test" })
      .first()
      .click();
    await expect
      .element(page.getByRole("main", { name: "Repository settings" }))
      .toBeVisible();
    expect(connected.recordOpened).not.toHaveBeenCalled();
    expect(connected.session.repositoryHistory.read).not.toHaveBeenCalled();
    await expect
      .element(page.getByRole("combobox", { name: "History ordering" }))
      .toBeVisible();
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await expect
      .element(page.getByRole("main", { name: "Open project" }))
      .toBeVisible();
  });

  it("returns to the same graph selection from repository settings and applies saved ordering", async () => {
    const connected = await connectedSession();
    connected.finishSynchronization();
    await render(
      <ApplicationShell
        desktopUpdates={undefined}
        productVersion="test"
        repositoryFilesystem={undefined}
        session={connected.session}
      />,
    );
    await page
      .getByRole("main", { name: "Open project" })
      .getByRole("option")
      .first()
      .click();
    const graph = page.getByRole("grid", { name: "Commit history" });
    const commit = graph.getByRole("row", { name: /^cached commit,/ });
    await expect.element(commit).toBeVisible();
    await commit.click();
    const graphElement = graph.element();
    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: "Repository settings for rebase-test" })
      .click();
    await expect
      .element(page.getByRole("main", { name: "Repository settings" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("navigation", { name: "Branches" }))
      .not.toBeInTheDocument();
    await page
      .getByRole("combobox", { name: "History ordering" })
      .selectOptions("chronological");
    await page
      .getByRole("button", { name: "Open rebase-test", exact: true })
      .click();
    await expect.element(commit).toBeVisible();
    expect(graph.element()).toBe(graphElement);
    await expect.element(commit).toHaveAttribute("aria-selected", "true");
    await expect
      .element(page.getByRole("navigation", { name: "Branches" }))
      .toBeVisible();
    await page
      .getByRole("button", { name: "Repository settings for rebase-test" })
      .click();
    await expect
      .element(page.getByRole("combobox", { name: "History ordering" }))
      .toHaveValue("chronological");
  });

  it("opens the repository chosen in the folder picker", async () => {
    const connected = await connectedSession();
    connected.finishSynchronization();
    await render(
      <ApplicationShell
        desktopUpdates={undefined}
        productVersion="test"
        repositoryFilesystem={undefined}
        session={connected.session}
      />,
    );
    const picker = await chooseFolder("repo");
    await expect.element(picker).not.toBeInTheDocument();
    await expect
      .element(
        page
          .getByRole("grid", { name: "Commit history" })
          .getByRole("row", { name: /^cached commit,/ }),
      )
      .toBeVisible();
  });

  it("explains why a chosen folder cannot be opened", async () => {
    const connected = await connectedSession(() => {
      throw new EnvironmentHttpRejected({
        failure: { _tag: "RepositoryPathRejected", reason: "NotRepository" },
      });
    });
    await render(
      <ApplicationShell
        desktopUpdates={undefined}
        productVersion="test"
        repositoryFilesystem={undefined}
        session={connected.session}
      />,
    );
    const picker = await chooseFolder("repo");
    await expect
      .element(picker.getByText("This folder is not a Git repository."))
      .toBeVisible();
  });

  it("renders the empty project shell and focuses repository search", async () => {
    await renderShell();

    await expect
      .element(page.getByRole("region", { name: "Rebase application" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("navigation", { name: "Projects" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Projects" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("status"))
      .toHaveAttribute("data-connection-state", "PairingRequired");
    await expect
      .element(page.getByRole("main", { name: "Open project" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("searchbox", { name: "Search repositories" }))
      .toHaveFocus();
    await expect
      .element(page.getByRole("button", { name: "Browse files" }))
      .toBeDisabled();
  });

  it("opens the project launcher from expanded and collapsed sidebars", async () => {
    await renderShell();

    const repositorySearch = page.getByRole("searchbox", {
      name: "Search repositories",
    });
    const projectFilter = page.getByRole("textbox", {
      name: "Filter open projects",
    });
    await projectFilter.fill("rebase");
    await page.getByRole("button", { name: "Open project" }).click();
    await expect.element(repositorySearch).toHaveFocus();

    await page
      .getByRole("button", { name: "Collapse Projects sidebar" })
      .click();
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Projects" }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Open project" }).click();
    await expect.element(repositorySearch).toHaveFocus();

    await page.getByRole("button", { name: "Expand Projects sidebar" }).click();
    await expect.element(projectFilter).toHaveValue("rebase");
  });

  it("resizes the branches sidebar within its configured bounds", async () => {
    await renderRepositoryWorkspace();
    const branches = page.getByRole("navigation", { name: "Branches" });
    const handle = page.getByRole("separator", {
      name: "Resize branches sidebar",
    });
    const width = () => branches.element().getBoundingClientRect().width;
    const initialWidth = width();

    await handle.click();
    await expect.element(handle).toHaveFocus();
    await userEvent.keyboard("{ArrowRight>30}");

    const maximumWidth = width();
    expect(maximumWidth).toBeGreaterThan(initialWidth);
    expect(maximumWidth).toBeGreaterThanOrEqual(415);
    expect(maximumWidth).toBeLessThanOrEqual(417);

    await userEvent.keyboard("{ArrowLeft>60}");

    const minimumWidth = width();
    expect(minimumWidth).toBeLessThan(initialWidth);
    expect(minimumWidth).toBeGreaterThanOrEqual(191);
    expect(minimumWidth).toBeLessThanOrEqual(193);
  });

  it("keeps cached commit rows visible while reconnecting", async () => {
    const connected = await connectedSession();
    await render(
      <ApplicationShell
        desktopUpdates={undefined}
        productVersion="0.0.2-test"
        repositoryFilesystem={undefined}
        session={connected.session}
      />,
    );
    await page
      .getByRole("main", { name: "Open project" })
      .getByRole("option")
      .filter({ hasText: "rebase-test" })
      .first()
      .click();
    const commit = page
      .getByRole("grid", { name: "Commit history" })
      .getByRole("row", { name: /^cached commit,/ });
    await expect.element(commit).toBeVisible();
    connected.finishSynchronization();

    connected.disconnect();

    await expect.element(commit).toBeVisible();
    await commit.click();
    await expect.element(commit).toHaveAttribute("aria-selected", "true");
  });
});

async function chooseFolder(name: string) {
  await page.getByRole("button", { name: "Browse files" }).click();
  const picker = page.getByRole("dialog", { name: "Choose repository" });
  await picker
    .getByRole("button", { name: new RegExp(`^${name} Folder`) })
    .click();
  await picker
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  return picker;
}

async function renderShell() {
  return render(
    <ApplicationShell
      desktopUpdates={undefined}
      productVersion="0.0.2-test"
      repositoryFilesystem={undefined}
      session={pairingRequiredSession()}
    />,
  );
}

async function renderRepositoryWorkspace() {
  return render(
    <div style={{ height: 720, width: 900 }}>
      <RepositoryWorkspace
        activeWorktreePath="/repo"
        environmentId={undefined}
        history={undefined}
        logicalRepositoryId="00000000-0000-4000-8000-000000000001"
        repositoryId="00000000-0000-4000-8000-000000000001"
        repositoryName="rebase-test"
        switchWorktree={() => undefined}
      />
    </div>,
  );
}

function pairingRequiredSession(): LocalEnvironmentSession {
  const sessionState = { _tag: "PairingRequired" } as const;
  const unsubscribe = () => undefined;
  return {
    changes: { subscribe: () => unsubscribe },
    getSnapshot: () => sessionState,
    repositoryHistory: {
      read: async () => Promise.reject(new Error("Unavailable")),
      synchronize: async () => Promise.reject(new Error("Unavailable")),
    },
    requests: fakeRequests(idleOperation),
    start: () => undefined,
    stop: () => undefined,
    subscribe: () => unsubscribe,
  };
}

async function connectedSession(
  remember: (repository: RepositoryCatalogEntry) => RepositoryCatalogEntry = (
    repository,
  ) => repository,
) {
  const environmentId = "00000000-0000-4000-8000-000000000020";
  const repositoryId = "00000000-0000-4000-8000-000000000021";
  const oid = "c".repeat(40);
  const commit: RepositoryCommit = {
    author: identity(),
    committer: identity(),
    oid,
    parents: [],
    subject: "cached commit",
  };
  const root = { name: "main", oid, type: "branch" as const };
  const repository: RepositoryCatalogEntry = {
    addedAt: "2026-09-04T12:00:00.000Z",
    id: repositoryId,
    lastOpenedAt: "2026-09-04T12:00:00.000Z",
    name: "rebase-test",
    path: "/repo",
  };
  const recordOpened = vi.fn(() => repository);
  const home: EnvironmentDirectory = {
    path: "/",
    breadcrumbs: [{ name: "/", path: "/" }],
    entries: [
      { kind: "Folder", name: "repo", path: "/repo", type: "directory" },
    ],
    truncated: false,
  };
  const refs: RepositoryRefs = {
    branches: [{ name: "main", target: oid, worktreePath: "/repo" }],
    remoteBranches: [],
    repositoryId,
    tags: [],
    truncated: {
      branches: false,
      remoteBranches: false,
      tags: false,
    },
    worktrees: [
      {
        head: { branch: "main", commit: oid },
        main: true,
        path: "/repo",
      },
    ],
  };
  const rpc = await fakeRpc(async () => refs);
  const listeners = new Set<() => void>();
  let state: ReturnType<LocalEnvironmentSession["getSnapshot"]> = {
    _tag: "Connected",
    accessCapabilities: [],
    capabilities: currentEnvironmentCapabilities,
    environmentId,
    rpc,
  };
  let finishSynchronization: () => void = () => undefined;
  const synchronizationFinished = new Promise<void>((resolve) => {
    finishSynchronization = resolve;
  });
  const session: LocalEnvironmentSession = {
    changes: { subscribe: () => () => undefined },
    getSnapshot: () => state,
    repositoryHistory: {
      read: vi.fn(async () =>
        encodeRepositoryHistoryPage({
          commits: [commit],
          objectFormat: "sha1",
          refTargets: [root],
          repositoryId,
          requestId: crypto.randomUUID(),
        }),
      ),
      synchronize: vi.fn(async (_request, acceptBatch) => {
        await acceptBatch(
          encodeRepositoryHistoryBatch({
            commits: [commit],
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 0,
          }),
        );
        await synchronizationFinished;
        return 1;
      }),
    },
    requests: fakeRequests(
      idleOperation,
      respond(RepositoryCatalogHttpApi.list, () => ({
        repositories: [repository],
      })),
      respond(RepositoryCatalogHttpApi.recordOpened, recordOpened),
      respond(EnvironmentFilesystemHttpApi.listDirectory, () => home),
      respond(RepositoryCatalogHttpApi.remember, () => remember(repository)),
    ),
    start: () => undefined,
    stop: () => undefined,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    disconnect: () => {
      state = { _tag: "Reconnecting", attempt: 1, environmentId };
      for (const listener of listeners) listener();
    },
    finishSynchronization,
    recordOpened,
    session,
  };
}

function identity() {
  return {
    email: "alex@example.test",
    name: "Alex",
    timestampSeconds: 1_777_777_777,
    timezoneOffsetMinutes: 120,
  };
}
