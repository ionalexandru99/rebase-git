import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/index";
import "@rebase/web/styles.css";
import type { RepositoryCommit, RepositoryRefs } from "@rebase/contracts";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from "@tanstack/react-query-persist-client";
import { expect, it, vi } from "vite-plus/test";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import { fakeRpc } from "#tests-ui/runtime/fake-rpc";
import { render } from "#tests-ui/runtime/render";
import {
  createBrowserHistoryFilterStore,
  openCommitGraphHistory,
  resolveHistoryScope,
} from "#web/features/commit-graph/index";
import { storeRepositoryHistoryPage } from "#web/features/repository-history/replica/repository-history-store";
import { RepositoryHistoryOffline } from "#web/features/repository-history/repository-history-reader.contract";
import {
  useApplyToRefs,
  useRepositoryRefs,
} from "#web/features/repository-refs/index";
import { RepositoryScopeProvider } from "#web/features/repository-scope/index";
import { createEnvironmentQueryClient } from "#web/platform/query/environment-query-client";
import { createEnvironmentQueryPersistence } from "#web/platform/query/environment-query-persistence";
import { RepositoryWorkspace } from "#web-ui/app/workspace/repository-workspace";

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
  const logicalId = refs.logicalRepositoryId ?? "";
  const queryClient = await restoredRefs(environmentId, logicalId, refs);
  let online = false;
  const rpc = await fakeRpc(async () => {
    if (!online) throw new Error("offline");
    return refs;
  });
  const screen = await render(
    <RefsProbe
      logicalRepositoryId={logicalId}
      repositoryId={refs.repositoryId}
    />,
    { environment: { environmentId, rpc }, queryClient },
  );

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
  const queryClient = await restoredRefs(environmentId, logicalId, refs);
  const reads: PromiseWithResolvers<RepositoryRefs>[] = [];
  const rpc = await fakeRpc(() => {
    const read = Promise.withResolvers<RepositoryRefs>();
    reads.push(read);
    return read.promise;
  });
  const screen = await render(
    <RepositoryScopeProvider
      scope={repositoryScope({
        repositoryId: refs.repositoryId,
        logicalRepositoryId: logicalId,
        worktreePath: "/feature",
      })}
    >
      <RefsProbe
        logicalRepositoryId={logicalId}
        repositoryId={refs.repositoryId}
      />
      <RenameMain />
    </RepositoryScopeProvider>,
    { environment: { environmentId, rpc }, queryClient },
  );
  await vi.waitFor(() => expect(reads).toHaveLength(1));
  reads[0]?.reject(new Error("offline"));
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("The Environment did not answer.");

  await screen.getByRole("button", { name: "Rename main" }).click();
  await vi.waitFor(() => expect(reads).toHaveLength(2));
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
    const queryClient = await restoredRefs(environmentId, logicalId, refs);
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
        <RepositoryWorkspace
          activeWorktreePath="/feature"
          environmentId={environmentId}
          logicalRepositoryId={logicalId}
          repositoryId={refs.repositoryId}
          repositoryName="Cached repository"
          history={openCommitGraphHistory(reader)}
          switchWorktree={() => undefined}
        />
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

function RefsProbe({
  logicalRepositoryId,
  repositoryId,
}: {
  readonly logicalRepositoryId: string;
  readonly repositoryId: string;
}) {
  const { error, refs, restored, retry } = useRepositoryRefs(
    repositoryId,
    logicalRepositoryId,
  );
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
  const applyToRefs = useApplyToRefs();
  return (
    <button type="button" onClick={() => void applyToRefs(renameMain)}>
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

async function restoredRefs(
  environmentId: string,
  logicalId: string,
  refs: RepositoryRefs,
) {
  const persistence = createEnvironmentQueryPersistence();
  const saved = createEnvironmentQueryClient();
  await saved.fetchQuery({
    queryKey: ["repository-refs", environmentId, logicalId],
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
