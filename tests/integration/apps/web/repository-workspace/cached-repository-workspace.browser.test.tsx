import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import "@rebase/web/styles.css";
import {
  RepositoryBranchesApi,
  type RepositoryCommit,
  type RepositoryRefs,
  RepositoryRefsApi,
} from "@rebase/contracts";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from "@tanstack/react-query-persist-client";
import { expect, it, vi } from "vite-plus/test";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import {
  fakeRequests,
  respond,
  unanswered,
} from "#tests-ui/runtime/fake-requests";
import { render } from "#tests-ui/runtime/render";
import { OpenedHistoryContext } from "#web/app/shell/opened-history-context";
import { RepositoryWorkspace } from "#web/app/workspace/repository-workspace";
import { openCommitGraphHistory } from "#web/features/commit-graph/paging/commit-graph-history";
import { createBrowserHistoryFilterStore } from "#web/features/commit-graph/scope/browser-history-filter-store";
import { resolveHistoryScope } from "#web/features/commit-graph/scope/history-scope";
import { useRepositoryRefs } from "#web/features/refs/repository-refs";
import { storeRepositoryHistoryPage } from "#web/features/repository-history/replica/repository-history-store";
import { RepositoryHistoryOffline } from "#web/features/repository-history/repository-history-reader";
import { environmentQueryKey } from "#web/platform/query/environment-query";
import { createEnvironmentQueryClient } from "#web/platform/query/environment-query-client";
import { createEnvironmentQueryPersistence } from "#web/platform/query/environment-query-persistence";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope";
import { useCommand } from "#web/platform/query/use-command";

it("restores only persisted refs, unconfirmed, for the same protocol", async () => {
  const persistence = createEnvironmentQueryPersistence();
  const refs = repositoryRefs();
  const refsKey = ["repository-refs", crypto.randomUUID(), refs.repositoryId];
  const refsMeta = {
    changes: "refs",
    repositoryId: refs.repositoryId,
    persist: true,
  } as const;
  const saved = createEnvironmentQueryClient();
  await saved.fetchQuery({
    queryKey: refsKey,
    queryFn: async () => refs,
    meta: refsMeta,
  });
  await saved
    .fetchQuery({
      queryKey: refsKey,
      queryFn: () => Promise.reject(new Error("offline")),
      meta: refsMeta,
      staleTime: 0,
    })
    .catch(() => undefined);
  await saved.fetchQuery({
    queryKey: ["operation"],
    queryFn: async () => "idle",
    meta: { changes: "index", repositoryId: refs.repositoryId },
  });
  await persistQueryClientSave({ ...persistence, queryClient: saved });

  const restored = createEnvironmentQueryClient();
  await persistQueryClientRestore({ ...persistence, queryClient: restored });
  const query = restored.getQueryCache().find({ queryKey: refsKey });
  expect(query?.state.data).toEqual(refs);
  expect(query?.state.status).toBe("success");
  expect(query?.isFetched()).toBe(false);
  expect(query?.state.isInvalidated).toBe(true);
  expect(restored.getQueryData(["operation"])).toBeUndefined();

  const upgraded = createEnvironmentQueryClient();
  await persistQueryClientRestore({
    ...persistence,
    buster: "protocol-next",
    queryClient: upgraded,
  });
  expect(upgraded.getQueryData(refsKey)).toBeUndefined();
});

it("keeps restored refs unconfirmed until a live read answers", async () => {
  const environmentId = crypto.randomUUID();
  const refs = repositoryRefs();
  const queryClient = await restoredRefs(environmentId, refs);
  let online = false;
  const requests = fakeRequests(
    respond(RepositoryRefsApi.read, async () => {
      if (!online) throw unanswered;
      return refs;
    }),
  );
  const screen = await render(<RefsProbe repositoryId={refs.repositoryId} />, {
    environment: { environmentId, requests },
    queryClient,
  });

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("The Environment did not answer.");
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Restored feature, main");

  online = true;
  await screen.getByRole("button", { name: "Retry" }).click();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Live feature, main");
});

it("keeps restored refs restored through a branch write until a live read answers", async () => {
  const environmentId = crypto.randomUUID();
  const refs = repositoryRefs();
  const logicalId = refs.logicalRepositoryId ?? "";
  const queryClient = await restoredRefs(environmentId, refs);
  const reads: PromiseWithResolvers<RepositoryRefs>[] = [];
  const requests = fakeRequests(
    respond(RepositoryRefsApi.read, () => {
      const read = Promise.withResolvers<RepositoryRefs>();
      reads.push(read);
      return read.promise;
    }),
    respond(RepositoryBranchesApi.rename, async ({ newName }) => ({
      branch: { name: newName, target: oid },
      previousName: "main",
    })),
  );
  const screen = await render(
    <RepositoryScopeProvider
      scope={repositoryScope({
        repositoryId: refs.repositoryId,
        logicalRepositoryId: logicalId,
        worktreePath: "/feature",
      })}
    >
      <RefsProbe repositoryId={refs.repositoryId} />
      <RenameMain />
    </RepositoryScopeProvider>,
    { environment: { environmentId, requests }, queryClient },
  );
  await expect.poll(() => reads).toHaveLength(1);
  reads[0]?.reject(unanswered);
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("The Environment did not answer.");

  await screen.getByRole("button", { name: "Rename main" }).click();
  await expect.poll(() => reads).toHaveLength(2);
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Restored feature, main");

  reads[1]?.resolve(renameMain(refs));
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Live feature, trunk");
});

it.each(["Automatic", "Custom"] as const)(
  "renders cached %s history before live refs respond",
  async (mode) => {
    const environmentId = crypto.randomUUID();
    const refs = repositoryRefs();
    const logicalId = refs.logicalRepositoryId ?? "";
    const queryClient = await restoredRefs(environmentId, refs);
    const custom = {
      _tag: "Custom",
      selections: [
        { _tag: "LocalBranch", name: "feature" },
        { _tag: "Tag", name: "new-tag" },
      ],
    } as const;
    const filterStore = createBrowserHistoryFilterStore();
    if (mode === "Custom") filterStore.save(environmentId, logicalId, custom);
    const roots = resolveHistoryScope(
      { _tag: "Automatic" },
      refs,
      "/feature",
    ).roots;
    await storeRepositoryHistoryPage(
      environmentId,
      logicalId,
      {
        commits: [commit],
        objectFormat: "sha1",
        refTargets: roots,
        repositoryId: refs.repositoryId,
        requestId: crypto.randomUUID(),
      },
      { limit: 100, order: "topological", roots },
    );
    const read = vi.fn(() => Promise.reject(new RepositoryHistoryOffline()));
    const reader = createBrowserRepositoryHistoryReader({
      environmentId,
      repositoryId: refs.repositoryId,
      logicalRepositoryId: logicalId,
      gateway: {
        read,
        synchronize: async () => {
          throw new RepositoryHistoryOffline();
        },
      },
    });
    const screen = await render(
      <div style={{ height: 720, width: 1280 }}>
        <RepositoryScopeProvider
          scope={repositoryScope({
            repositoryId: refs.repositoryId,
            logicalRepositoryId: logicalId,
            worktreePath: "/feature",
            connected: false,
          })}
        >
          <OpenedHistoryContext.Provider
            value={{ ...openCommitGraphHistory(reader), reader }}
          >
            <RepositoryWorkspace />
          </OpenedHistoryContext.Provider>
        </RepositoryScopeProvider>
      </div>,
      { environment: { environmentId }, queryClient },
    );
    await expect
      .element(screen.getByRole("row", { name: /^Cached commit,/ }))
      .toBeVisible();
    await expect
      .element(
        screen
          .getByRole("group", { name: `${mode} history scope` })
          .getByRole("button", { name: "Copy feature", exact: true }),
      )
      .toBeVisible();
    await expect
      .element(
        screen
          .getByRole("group", { name: `${mode} history scope` })
          .getByRole("button", {
            name: `Copy ${mode === "Automatic" ? "main" : "new-tag"}`,
            exact: true,
          }),
      )
      .toBeVisible();
    reader.close();
    expect(read).not.toHaveBeenCalled();
    expect(filterStore.load(environmentId, logicalId)).toEqual(
      mode === "Automatic" ? { _tag: "Automatic" } : custom,
    );
  },
);

function RefsProbe({ repositoryId }: { readonly repositoryId: string }) {
  const { error, refs, restored, retry } = useRepositoryRefs(repositoryId);
  return (
    <div>
      <p role="status">
        {restored ? "Restored" : "Live"}{" "}
        {refs?.branches.map(({ name }) => name).join(", ")}
      </p>
      {error === null ? null : <p role="alert">{error}</p>}
      <button type="button" onClick={retry}>
        Retry
      </button>
    </div>
  );
}

function RenameMain() {
  const rename = useCommand(RepositoryBranchesApi.rename);
  return (
    <button
      type="button"
      onClick={() => void rename.run({ name: "main", newName: "trunk" })}
    >
      Rename main
    </button>
  );
}

function renameMain(refs: RepositoryRefs): RepositoryRefs {
  return {
    ...refs,
    branches: refs.branches.map((branch) =>
      branch.name === "main" ? { ...branch, name: "trunk" } : branch,
    ),
  };
}

async function restoredRefs(environmentId: string, refs: RepositoryRefs) {
  const persistence = createEnvironmentQueryPersistence();
  const saved = createEnvironmentQueryClient();
  const input = { repositoryId: refs.repositoryId };
  await saved.fetchQuery({
    queryKey: environmentQueryKey(
      environmentId,
      refs.repositoryId,
      RepositoryRefsApi.read,
      input,
    ),
    queryFn: async () => refs,
    meta: { changes: "refs", repositoryId: refs.repositoryId, persist: true },
  });
  await persistQueryClientSave({ ...persistence, queryClient: saved });
  const restored = createEnvironmentQueryClient();
  await persistQueryClientRestore({ ...persistence, queryClient: restored });
  return restored;
}

const oid = "a".repeat(40);
const identity = {
  email: "alex@example.test",
  name: "Alex",
  timestampSeconds: 1_777_777_777,
  timezoneOffsetMinutes: 0,
};
const commit: RepositoryCommit = {
  author: identity,
  committer: identity,
  oid,
  parents: [],
  subject: "Cached commit",
};

function repositoryRefs(): RepositoryRefs {
  return {
    repositoryId: crypto.randomUUID(),
    logicalRepositoryId: crypto.randomUUID(),
    branches: [
      {
        name: "feature",
        target: oid,
        worktreePath: "/feature",
        upstream: { name: "origin/feature", ahead: 0, behind: 0, gone: false },
      },
      {
        name: "main",
        target: oid,
        upstream: { name: "origin/main", ahead: 0, behind: 0, gone: false },
      },
    ],
    remoteBranches: [
      { remote: "origin", name: "feature", target: oid },
      { remote: "origin", name: "main", target: oid },
    ],
    remoteDefaultBranches: [{ remote: "origin", name: "main" }],
    remoteProviders: [{ remote: "origin", provider: "github" }],
    tags: [{ name: "v1.0.0", target: oid }],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      {
        path: "/feature",
        main: true,
        head: { branch: "feature", commit: oid },
      },
      { path: "/detached", main: false, head: { commit: oid } },
    ],
  };
}
